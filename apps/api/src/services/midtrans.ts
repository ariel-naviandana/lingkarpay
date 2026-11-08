import { config, SIGNATURE_KEY } from "../config.js";
import { AppError } from "../lib/errors.js";
import { requestJson, type HttpResult } from "../lib/http.js";
import { verifySignature } from "../lib/signature.js";

// Hanya sandbox. Tidak ada mode produksi di prototipe ini.
const SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const API_URL = "https://api.sandbox.midtrans.com/v2";

const authHeader = () =>
  "Basic " + Buffer.from(config.MIDTRANS_SERVER_KEY + ":").toString("base64");

/** Kanal yang diaktifkan: VA bank dan e-wallet. QRIS sengaja tidak dipakai di sandbox. */
export const ENABLED_PAYMENTS = [
  "bca_va",
  "bni_va",
  "bri_va",
  "permata_va",
  "other_va",
  "gopay",
  "shopeepay",
];

export interface SnapItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface SnapParams {
  orderId: string;
  grossAmount: number;
  items?: SnapItem[];
  customer: { firstName: string; email: string };
  expiryMinutes: number;
  enabledPayments?: string[];
}

/** Klien HTTP ke Midtrans. Dapat diganti di tes agar tidak ada panggilan jaringan sungguhan. */
export const gatewayHttp: { request: typeof requestJson } = { request: requestJson };

async function call(url: string, method: "GET" | "POST", body?: unknown): Promise<HttpResult> {
  try {
    return await gatewayHttp.request(url, {
      method,
      body,
      headers: {
        Accept: "application/json",
        Authorization: authHeader(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (err) {
    // Sertakan host dan kode jaringan (mis. ETIMEDOUT, ENOTFOUND) agar penyebabnya terlihat.
    const code = (err as { code?: string }).code ?? (err as Error).name ?? "unknown";
    throw new AppError(
      "GATEWAY_UNREACHABLE",
      `Tidak dapat menghubungi ${new URL(url).host} (${code})`,
      502,
    );
  }
}

export async function createSnapTransaction(
  p: SnapParams,
): Promise<{ token: string; redirectUrl: string }> {
  const body: Record<string, unknown> = {
    transaction_details: {
      order_id: p.orderId,
      gross_amount: Math.trunc(p.grossAmount),
    },
    customer_details: { first_name: p.customer.firstName, email: p.customer.email },
    expiry: { unit: "minutes", duration: p.expiryMinutes },
  };
  if (p.items) body.item_details = p.items;
  if (p.enabledPayments) body.enabled_payments = p.enabledPayments;

  const res = await call(SNAP_URL, "POST", body);
  const data = res.json;
  if (!res.ok || typeof data.token !== "string") {
    const msg = Array.isArray(data.error_messages)
      ? data.error_messages.join("; ")
      : "Midtrans menolak permintaan";
    throw new AppError("GATEWAY_ERROR", msg, 502);
  }
  return { token: data.token, redirectUrl: String(data.redirect_url ?? "") };
}

export interface GatewayStatus {
  /** false bila Midtrans tidak mengenal order_id (status_code 404 di body). */
  found: boolean;
  httpStatus: number;
  data: Record<string, any>;
  /** true bila SHA512(order_id+status_code+gross_amount+ServerKey) cocok. */
  signatureValid: boolean;
}

export async function getTransactionStatus(orderId: string): Promise<GatewayStatus> {
  const res = await call(`${API_URL}/${encodeURIComponent(orderId)}/status`, "GET");
  if (res.status === 401) {
    // Server Key ditolak. Jangan dianggap "order tidak ditemukan".
    throw new AppError(
      "GATEWAY_AUTH_FAILED",
      "Server Key ditolak Midtrans (401). Periksa MIDTRANS_SERVER_KEY di .env",
      502,
    );
  }
  const data = res.json;
  const found = res.ok && String(data.status_code) !== "404";
  return {
    found,
    httpStatus: res.status,
    data,
    signatureValid: found ? verifySignature(data, SIGNATURE_KEY) : false,
  };
}
