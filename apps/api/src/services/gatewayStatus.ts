import type { PoolClient } from "pg";
import { withTx } from "../db/pool.js";
import { parseRupiah } from "../lib/money.js";
import { getTransactionStatus } from "./midtrans.js";
import { settleArrearByOrder } from "./arrears.js";
import { enqueueRecordPayment } from "./outbox.js";
import { mapGatewayStatus, transitionOrder } from "./orderStatus.js";
import { refreshPeriodReadiness } from "./periods.js";

export type ApplyOutcome =
  | "applied"
  | "unchanged"
  | "ignored_transition"
  | "ignored_status"
  | "amount_mismatch";

export interface GatewayData {
  transaction_status?: unknown;
  fraud_status?: unknown;
  transaction_id?: unknown;
  payment_type?: unknown;
  gross_amount?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Menerapkan status dari gateway (webhook ATAU Status API) ke order, di dalam transaksi.
 * Pemanggil wajib sudah memverifikasi signature. Urutan pemeriksaan:
 * 1. jumlah harus sama dengan tagihan, 2. status dipetakan, 3. transisi lewat mesin status.
 * Status final tidak pernah diturunkan, sehingga notifikasi tidak berurutan tidak merusak data.
 */
export async function applyGatewayStatus(
  client: PoolClient,
  order: { id: number; gross_amount: number | string; period_id: number },
  data: GatewayData,
  source: "webhook" | "status_api",
): Promise<ApplyOutcome> {
  if (parseRupiah(data.gross_amount) !== Number(order.gross_amount)) return "amount_mismatch";

  const target = mapGatewayStatus(data.transaction_status, data.fraud_status);
  if (!target) return "ignored_status";

  const result = await transitionOrder(
    client,
    order.id,
    target,
    `${source}:${String(data.transaction_status)}`,
    {
      gatewayRef: str(data.transaction_id),
      paymentType: str(data.payment_type),
      paidAt: target === "SETTLED" ? new Date() : null,
    },
  );
  if (result.outcome === "rejected") return "ignored_transition";
  if (result.outcome === "unchanged") return "unchanged";

  if (target === "SETTLED") {
    // Pelunasan tunggakan periode yang sudah ditutup: diteruskan ke kreditor, tidak dicatat ke contract
    // (contract v2 hanya menerima pembayaran saat periode berjalan) dan tidak mengubah status periode.
    if (await settleArrearByOrder(client, order.id)) return "applied";
    // Satu pembayaran sah, satu job on-chain (outbox). Kegagalan chain tidak membatalkan pembayaran.
    await enqueueRecordPayment(client, order.id);
    await refreshPeriodReadiness(client, order.period_id);
  }
  return "applied";
}

export interface SyncResult {
  found: boolean;
  signatureValid: boolean;
  gatewayStatus?: string;
  outcome: ApplyOutcome | "unknown_order" | null;
}

/**
 * Pemulihan: tanya Status API Midtrans lalu terapkan status-nya (mis. notifikasi hilang
 * atau tiba tidak berurutan). Respons dengan signature tidak cocok tidak diterapkan.
 */
export async function syncOrderFromGateway(orderId: string): Promise<SyncResult> {
  const s = await getTransactionStatus(orderId);
  if (!s.found) {
    console.warn(`[Sync] Order ${orderId} tidak ditemukan di Midtrans`);
    return { found: false, signatureValid: s.signatureValid, outcome: null };
  }
  if (!s.signatureValid) {
    // Jangan diterapkan. Tidak mencetak signature atau kunci, hanya identitas order.
    console.warn(`[Sync] Signature Status API tidak cocok untuk order ${orderId}; status tidak diterapkan`);
    return { found: true, signatureValid: false, outcome: null };
  }
  const outcome = await withTx(async (client) => {
    const { rows } = await client.query<{ id: number; gross_amount: string | number; period_id: number }>(
      "SELECT id, gross_amount, period_id FROM orders WHERE order_id = $1",
      [orderId],
    );
    if (!rows[0]) return "unknown_order" as const;
    return applyGatewayStatus(client, rows[0], s.data, "status_api");
  });
  console.info(`[Sync] Order ${orderId} disinkronkan: ${s.data.transaction_status} -> outcome: ${outcome}`);
  return {
    found: true,
    signatureValid: true,
    gatewayStatus: String(s.data.transaction_status),
    outcome,
  };
}

/**
 * Menyinkronkan beberapa order PENDING dari Midtrans untuk endpoint baca (tanpa webhook di lokal).
 * Dibatasi supaya permintaan baca tidak lambat: paling banyak `max` order, berjalan paralel,
 * dan tiap order dipotong setelah `timeoutMs`. Kegagalan satu order tidak mengganggu yang lain.
 */
export async function syncPendingOrders(
  orderIds: string[],
  opts: { max?: number; timeoutMs?: number } = {},
): Promise<void> {
  const { max = 5, timeoutMs = 4000 } = opts;
  const withTimeout = (p: Promise<unknown>) =>
    Promise.race([p, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  await Promise.allSettled(orderIds.slice(0, max).map((id) => withTimeout(syncOrderFromGateway(id))));
}
