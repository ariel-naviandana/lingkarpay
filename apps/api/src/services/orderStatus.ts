import type { PoolClient } from "pg";

/**
 * Mesin status pesanan. SATU-SATUNYA tempat status order boleh berubah.
 *
 * PENDING → SETTLED | FAILED | EXPIRED
 * SETTLED → ANCHORED | SETTLED_PENDING_CHAIN
 * SETTLED_PENDING_CHAIN → ANCHORED
 * FAILED, EXPIRED, ANCHORED: final
 */
export const ORDER_STATUSES = [
  "PENDING",
  "SETTLED",
  "SETTLED_PENDING_CHAIN",
  "ANCHORED",
  "FAILED",
  "EXPIRED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["SETTLED", "FAILED", "EXPIRED"],
  SETTLED: ["ANCHORED", "SETTLED_PENDING_CHAIN"],
  SETTLED_PENDING_CHAIN: ["ANCHORED"],
  ANCHORED: [],
  FAILED: [],
  EXPIRED: [],
};

/** Status yang berarti iuran sudah dibayar. */
export const PAID_STATUSES: readonly OrderStatus[] = [
  "SETTLED",
  "SETTLED_PENDING_CHAIN",
  "ANCHORED",
];
/** Status yang menempati slot "satu iuran aktif per anggota per periode". */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ["PENDING", ...PAID_STATUSES];

export const isPaid = (s: OrderStatus): boolean => PAID_STATUSES.includes(s);
export const isFinal = (s: OrderStatus): boolean => ALLOWED[s].length === 0;
export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED[from].includes(to);

/**
 * Memetakan transaction_status Midtrans ke status order.
 * null = tidak mengubah status (refund, authorize, capture yang masih challenge, dll).
 */
export function mapGatewayStatus(
  transactionStatus: unknown,
  fraudStatus?: unknown,
): OrderStatus | null {
  const ts = String(transactionStatus ?? "").toLowerCase();
  const fs = String(fraudStatus ?? "").toLowerCase();
  switch (ts) {
    case "settlement":
      return "SETTLED";
    case "capture":
      return fs === "challenge" ? null : "SETTLED";
    case "pending":
      return "PENDING";
    case "deny":
    case "cancel":
    case "failure":
      return "FAILED";
    case "expire":
      return "EXPIRED";
    default:
      return null;
  }
}

export interface TransitionExtra {
  gatewayRef?: string | null;
  paymentType?: string | null;
  paidAt?: Date | null;
}

export interface TransitionResult {
  /** changed = status berubah; unchanged = status sama; rejected = transisi tidak sah. */
  outcome: "changed" | "unchanged" | "rejected";
  from: OrderStatus;
  to: OrderStatus;
}

/**
 * Mengubah status order di dalam transaksi (wajib client dari withTx).
 * Baris order dikunci (FOR UPDATE) sehingga dua notifikasi serentak tidak saling menimpa.
 * Status final tidak pernah diturunkan: transisi tidak sah ditolak, bukan dilempar.
 */
export async function transitionOrder(
  client: PoolClient,
  orderPk: number,
  to: OrderStatus,
  reason: string,
  extra: TransitionExtra = {},
): Promise<TransitionResult> {
  const cur = await client.query<{ status: OrderStatus }>(
    "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
    [orderPk],
  );
  const row = cur.rows[0];
  if (!row) throw new Error(`order dengan id ${orderPk} tidak ada`);
  const from = row.status;

  const params = [
    orderPk,
    extra.gatewayRef ?? null,
    extra.paymentType ?? null,
    extra.paidAt ?? null,
  ];

  if (from === to) {
    // Status sama: hanya lengkapi data pendukung (mis. jenis pembayaran saat pending).
    await client.query(
      `UPDATE orders
          SET gateway_ref  = COALESCE($2, gateway_ref),
              payment_type = COALESCE($3, payment_type),
              paid_at      = COALESCE($4, paid_at),
              updated_at   = now()
        WHERE id = $1`,
      params,
    );
    return { outcome: "unchanged", from, to };
  }

  if (!canTransition(from, to)) {
    return { outcome: "rejected", from, to };
  }

  await client.query(
    `UPDATE orders
        SET status       = $5,
            gateway_ref  = COALESCE($2, gateway_ref),
            payment_type = COALESCE($3, payment_type),
            paid_at      = COALESCE($4, paid_at),
            updated_at   = now()
      WHERE id = $1`,
    [...params, to],
  );
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4)`,
    [orderPk, from, to, reason],
  );
  return { outcome: "changed", from, to };
}
