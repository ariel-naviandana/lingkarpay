import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { requestJson } from "../lib/http.js";

// Midtrans Iris (disbursement) sandbox. Creator membuat payout, approver menyetujuinya.
// Catatan: bentuk request/respons mengikuti dokumentasi Iris dan belum diuji di sandbox kelompok.
const BASE = "https://app.sandbox.midtrans.com/iris/api/v1";
const TIMEOUT_MS = 20_000;

export const irisAvailable = (): boolean =>
  config.IRIS_ENABLED && !!config.IRIS_CREATOR_KEY && !!config.IRIS_APPROVER_KEY;

const auth = (key: string) => "Basic " + Buffer.from(key + ":").toString("base64");

async function irisFetch(path: string, key: string, body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: auth(key),
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  try {
    const r = await requestJson(`${BASE}${path}`, { method: "POST", headers, body, timeoutMs: TIMEOUT_MS });
    return { ok: r.ok, status: r.status, data: r.json };
  } catch {
    throw new AppError("IRIS_UNREACHABLE", "Tidak dapat menghubungi Midtrans Iris", 502);
  }
}

export interface IrisBeneficiary {
  name: string;
  account: string;
  bank: string;
  email: string;
}

/** Peran Creator: membuat payout. Mengembalikan reference_no. */
export async function createIrisPayout(
  beneficiary: IrisBeneficiary,
  amount: number,
  notes: string,
  idempotencyKey: string,
): Promise<string> {
  const r = await irisFetch(
    "/payouts",
    config.IRIS_CREATOR_KEY!,
    {
      payouts: [
        {
          beneficiary_name: beneficiary.name,
          beneficiary_account: beneficiary.account,
          beneficiary_bank: beneficiary.bank,
          beneficiary_email: beneficiary.email,
          amount: `${amount}.00`,
          notes,
        },
      ],
    },
    idempotencyKey,
  );
  const ref = r.data?.payouts?.[0]?.reference_no;
  if (!r.ok || typeof ref !== "string") {
    const msg = Array.isArray(r.data?.errors) ? r.data.errors.join("; ") : r.data?.error_message;
    throw new AppError("IRIS_ERROR", `Iris menolak pembuatan payout: ${msg ?? r.status}`, 502);
  }
  return ref;
}

/** Peran Approver: menyetujui payout yang dibuat Creator. */
export async function approveIrisPayout(referenceNo: string): Promise<void> {
  const r = await irisFetch("/payouts/approve", config.IRIS_APPROVER_KEY!, {
    reference_nos: [referenceNo],
    otp: config.IRIS_OTP,
  });
  if (!r.ok) {
    const msg = Array.isArray(r.data?.errors) ? r.data.errors.join("; ") : r.data?.error_message;
    throw new AppError("IRIS_ERROR", `Iris menolak approve payout: ${msg ?? r.status}`, 502);
  }
}
