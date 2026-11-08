import { pool, withTx } from "../db/pool.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./auth.js";
import { syncOrderFromGateway } from "./gatewayStatus.js";
import { cancelTransaction, expireTransaction } from "./midtrans.js";
import { transitionOrder, type OrderStatus } from "./orderStatus.js";

/** Detail order untuk pemilik order atau pembuat kelompok. */
export async function getOrderForUser(user: AuthUser, orderId: string) {
  const { rows } = await pool.query<{
    id: number;
    order_id: string;
    status: OrderStatus;
    amount: number;
    penalty_amount: number;
    admin_fee: number;
    gross_amount: number;
    payment_type: string | null;
    gateway_ref: string | null;
    expires_at: Date;
    paid_at: Date | null;
    created_at: Date;
    member_user_id: number;
    circle_created_by: number;
    circle_id: number;
    period_no: number;
    chain_status: string | null;
  }>(
    `SELECT o.id, o.order_id, o.status, o.amount, o.penalty_amount, o.admin_fee, o.gross_amount,
            o.payment_type, o.gateway_ref, o.expires_at, o.paid_at, o.created_at,
            m.user_id AS member_user_id, c.created_by AS circle_created_by,
            c.id AS circle_id, p.period_no,
            j.status AS chain_status
       FROM orders o
       JOIN members m ON m.id = o.member_id
       JOIN periods p ON p.id = o.period_id
       JOIN circles c ON c.id = p.circle_id
       LEFT JOIN chain_jobs j ON j.order_id = o.id AND j.kind = 'recordPayment'
      WHERE o.order_id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) throw notFound("Order");
  if (o.member_user_id !== user.id && o.circle_created_by !== user.id) {
    throw forbidden("Order ini bukan milikmu");
  }
  const history = await pool.query<{ from_status: string | null; to_status: string; reason: string | null; created_at: Date }>(
    `SELECT from_status, to_status, reason, created_at
       FROM order_status_history WHERE order_id = $1 ORDER BY id`,
    [o.id],
  );
  return {
    orderId: o.order_id,
    circleId: o.circle_id,
    periodNo: o.period_no,
    status: o.status,
    amount: o.amount,
    penaltyAmount: o.penalty_amount,
    adminFee: o.admin_fee,
    grossAmount: o.gross_amount,
    paymentType: o.payment_type,
    gatewayRef: o.gateway_ref,
    expiresAt: o.expires_at,
    paidAt: o.paid_at,
    createdAt: o.created_at,
    chainStatus: o.chain_status,
    history: history.rows.map((h) => ({
      from: h.from_status,
      to: h.to_status,
      reason: h.reason,
      at: h.created_at,
    })),
  };
}

/**
 * Order PENDING yang sudah lewat batas (+5 menit toleransi) ditutup sebagai EXPIRED.
 * Notifikasi "expire" dari Midtrans biasanya sudah melakukannya; ini jaring pengaman.
 */
export async function expireOverdueOrders(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM orders
      WHERE status = 'PENDING' AND expires_at < now() - interval '5 minutes'
      LIMIT 100`,
  );
  let n = 0;
  for (const r of rows) {
    const res = await withTx((client) => transitionOrder(client, r.id, "EXPIRED", "sweeper:expired"));
    if (res.outcome === "changed") n++;
  }
  return n;
}

async function closeOrder(user: AuthUser, orderId: string, action: "cancel" | "expire") {
  const order = await getOrderForUser(user, orderId); // sekaligus cek kepemilikan
  const refused = action === "cancel" ? "NOT_CANCELLABLE" : "NOT_EXPIRABLE";
  const verb = action === "cancel" ? "dibatalkan" : "dikedaluwarsakan";
  if (order.status !== "PENDING") {
    throw conflict(refused, `Order berstatus ${order.status}; hanya PENDING yang bisa ${verb}`);
  }

  const result =
    action === "cancel" ? await cancelTransaction(orderId) : await expireTransaction(orderId);
  if (result.statusCode === "404") {
    throw conflict(
      "NO_GATEWAY_TRANSACTION",
      "Belum ada transaksi di Midtrans (metode bayar belum dipilih). Tunggu order kedaluwarsa.",
    );
  }

  // Selaraskan dengan kenyataan di Midtrans (berhasil, atau ternyata sudah dibayar/kedaluwarsa).
  const gatewaySync = await syncOrderFromGateway(orderId);
  const latest = await getOrderForUser(user, orderId);
  if (result.statusCode !== "200") {
    const detail = result.message ? `: ${result.message}` : "";
    throw conflict(
      refused,
      `Midtrans menolak (${result.statusCode}${detail}). Status order sekarang ${latest.status}.`,
    );
  }
  return { ...latest, gatewaySync };
}

/**
 * Membatalkan order PENDING (pemilik order atau pembuat kelompok): transaksi dibatalkan di Midtrans
 * lalu status disinkronkan (cancel -> FAILED), sehingga anggota bisa membuat order baru.
 * Order yang metode bayarnya belum dipilih tidak punya transaksi di Midtrans: tunggu kedaluwarsa.
 */
export const cancelOrder = (user: AuthUser, orderId: string) => closeOrder(user, orderId, "cancel");

/** Mengedaluwarsakan order PENDING sekarang lewat Expire API (hasil: EXPIRED). */
export const expireOrder = (user: AuthUser, orderId: string) => closeOrder(user, orderId, "expire");
