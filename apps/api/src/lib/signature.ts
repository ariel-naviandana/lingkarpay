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
  const expected = Buffer.from(
    computeSignature(
      String(payload.order_id),
      String(payload.status_code),
      String(payload.gross_amount),
      serverKey,
    ),
    "utf8",
  );
  const received = Buffer.from(payload.signature_key, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
