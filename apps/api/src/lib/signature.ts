import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Rumus signature Midtrans:
 * SHA512(order_id + status_code + gross_amount + ServerKey)
 * gross_amount WAJIB dipakai sebagai string persis seperti yang diterima.
 */
export function computeSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest("hex");
}

export interface SignedPayload {
  order_id?: unknown;
  status_code?: unknown;
  gross_amount?: unknown;
  signature_key?: unknown;
}

/** Verifikasi signature dengan perbandingan waktu-konstan. */
export function verifySignature(payload: SignedPayload, serverKey: string): boolean {
  if (typeof payload.signature_key !== "string") return false;
  const key = serverKey.trim();
  const orderId = String(payload.order_id);
  const statusCode = String(payload.status_code);
  const gross = String(payload.gross_amount);

  // Midtrans terkadang menghitung signature memakai string desimal asli ("302500.00"),
  // tanpa desimal ("302500"), atau fixed 2 desimal. Periksa variasi ini agar tidak ada false reject.
  const variants = Array.from(new Set([
    gross,
    gross.replace(/\.0+$/, ""),
    !isNaN(Number(gross)) ? Number(gross).toFixed(2) : gross,
  ]));

  const received = Buffer.from(payload.signature_key, "utf8");

  for (const g of variants) {
    const expected = Buffer.from(computeSignature(orderId, statusCode, g, key), "utf8");
    if (expected.length === received.length && timingSafeEqual(expected, received)) {
      return true;
    }
  }
  return false;
}
