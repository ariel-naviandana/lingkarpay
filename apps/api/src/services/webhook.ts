import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { pool, withTx } from "../db/pool.js";
import { sha256Hex } from "../lib/hash.js";
import { computeSignature, verifySignature } from "../lib/signature.js";
import { applyGatewayStatus } from "./gatewayStatus.js";

export interface NotificationResult {
  httpStatus: number;
  outcome: string;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Menangani notifikasi Midtrans.
 *
 * Urutan: payload lengkap → signature → dedupe → order dikenal → jumlah cocok → mesin status.
 * - signature salah: 401, dicatat.
 * - duplikat: 200 tanpa efek (idempoten).
 * - order tidak dikenal (mis. transaksi tes): 200 agar Midtrans tidak mengulang, dicatat.
 * - jumlah tidak cocok: 400, dicatat, status tidak berubah.
 * - transisi tidak sah (mis. notifikasi lama setelah status final): 200, diabaikan.
 */
export async function handleNotification(
  body: Record<string, any>,
  log: FastifyBaseLogger,
): Promise<NotificationResult> {
  const orderId = typeof body.order_id === "string" ? body.order_id : null;
  if (!orderId || body.status_code === undefined || body.gross_amount === undefined) {
    return { httpStatus: 400, outcome: "invalid_payload" };
  }

  // signature_key tidak ikut disimpan.
  const { signature_key: _omit, ...safePayload } = body;
  const payloadJson = JSON.stringify(safePayload);

  if (!verifySignature(body, config.MIDTRANS_SERVER_KEY)) {
    await pool.query(
      `INSERT INTO webhook_events
         (order_id, payload_hash, transaction_status, signature_valid, processed, outcome, payload)
       VALUES ($1, $2, $3, false, true, 'invalid_signature', $4)
       ON CONFLICT (payload_hash) DO NOTHING`,
      [orderId, sha256Hex("invalid|" + JSON.stringify(body)), str(body.transaction_status), payloadJson],
    );
    log.warn({ order_id: orderId }, "webhook ditolak: signature tidak cocok");
    if (config.DEV_TOOLS) {
      // Diagnostik pengembangan. Tidak pernah mencetak Server Key, hanya sifat-sifatnya.
      const key = config.MIDTRANS_SERVER_KEY;
      const gross = String(body.gross_amount);
      const variants: Record<string, string> = {
        as_received: gross,
        without_decimals: gross.replace(/\.0+$/, ""),
        two_decimals: Number(gross).toFixed(2),
      };
      const matched = Object.entries(variants)
        .filter(([, g]) => computeSignature(orderId, String(body.status_code), g, key) === body.signature_key)
        .map(([name]) => name);
      log.warn(
        {
          body_keys: Object.keys(body),
          status_code: body.status_code,
          status_code_type: typeof body.status_code,
          gross_amount: body.gross_amount,
          gross_amount_type: typeof body.gross_amount,
          signature_type: typeof body.signature_key,
          signature_length: typeof body.signature_key === "string" ? body.signature_key.length : null,
          server_key_length: key.length,
          server_key_has_whitespace: /\s/.test(key),
          server_key_looks_like_midtrans: /^(SB-)?Mid-server-/.test(key),
          matched_gross_variants: matched,
        },
        "diagnostik signature (DEV_TOOLS)",
      );
    }
    return { httpStatus: 401, outcome: "invalid_signature" };
  }

  // Hash kunci dedupe: kejadian yang sama (Midtrans mengirim ulang) menghasilkan hash yang sama.
  const payloadHash = sha256Hex(
    [
      "v1",
      orderId,
      String(body.status_code),
      String(body.transaction_status ?? ""),
      String(body.gross_amount),
      String(body.transaction_id ?? ""),
      String(body.fraud_status ?? ""),
      String(body.transaction_time ?? ""),
      String(body.settlement_time ?? ""),
    ].join("|"),
  );

  const result = await withTx(async (client): Promise<NotificationResult> => {
    const ev = await client.query<{ id: number }>(
      `INSERT INTO webhook_events
         (order_id, payload_hash, transaction_status, signature_valid, payload)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (payload_hash) DO NOTHING
       RETURNING id`,
      [orderId, payloadHash, str(body.transaction_status), payloadJson],
    );
    const eventId = ev.rows[0]?.id;
    if (eventId === undefined) return { httpStatus: 200, outcome: "duplicate" };

    const found = await client.query<{ id: number; gross_amount: number; period_id: number }>(
      "SELECT id, gross_amount, period_id FROM orders WHERE order_id = $1",
      [orderId],
    );
    let outcome: string;
    let httpStatus = 200;
    if (!found.rows[0]) {
      outcome = "unknown_order";
    } else {
      outcome = await applyGatewayStatus(client, found.rows[0], body, "webhook");
      if (outcome === "amount_mismatch") httpStatus = 400;
    }
    await client.query("UPDATE webhook_events SET processed = true, outcome = $2 WHERE id = $1", [
      eventId,
      outcome,
    ]);
    return { httpStatus, outcome };
  });

  log.info(
    { order_id: orderId, status: body.transaction_status, outcome: result.outcome },
    "webhook diproses",
  );
  return result;
}
