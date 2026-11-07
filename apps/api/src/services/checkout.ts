import { config } from "../config.js";
import { isUniqueViolation, pool, withTx } from "../db/pool.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./auth.js";
import { billItems, computeBill } from "./billing.js";
import { createSnapTransaction, ENABLED_PAYMENTS } from "./midtrans.js";
import { ACTIVE_STATUSES, isPaid, transitionOrder, type OrderStatus } from "./orderStatus.js";

interface CheckoutContext {
  member_id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  circle_id: number;
  circle_status: string;
  contribution_amount: number;
  penalty_pct: number;
  admin_fee: number;
  period_id: number;
  period_no: number;
  period_status: string;
  due_date: Date;
}

interface OrderRow {
  id: number;
  order_id: string;
  status: OrderStatus;
  amount: number;
  penalty_amount: number;
  admin_fee: number;
  gross_amount: number;
  snap_token: string | null;
  expires_at: Date;
}

export interface CheckoutResult {
  orderId: string;
  status: OrderStatus;
  /** Token untuk snap.pay(token) di frontend. */
  token: string | null;
  amount: number;
  penaltyAmount: number;
  adminFee: number;
  grossAmount: number;
  expiresAt: Date;
  /** true bila memakai ulang order PENDING yang sudah ada (idempoten). */
  reused: boolean;
}

const toResult = (o: OrderRow, reused: boolean): CheckoutResult => ({
  orderId: o.order_id,
  status: o.status,
  token: o.snap_token,
  amount: o.amount,
  penaltyAmount: o.penalty_amount,
  adminFee: o.admin_fee,
  grossAmount: o.gross_amount,
  expiresAt: o.expires_at,
  reused,
});

const ORDER_COLUMNS =
  "id, order_id, status, amount, penalty_amount, admin_fee, gross_amount, snap_token, expires_at";

async function findActiveOrder(memberId: number, periodId: number): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE member_id = $1 AND period_id = $2 AND status = ANY($3::text[])`,
    [memberId, periodId, ACTIVE_STATUSES],
  );
  return rows[0] ?? null;
}

async function loadContext(circleId: number, periodId: number, memberId: number) {
  const { rows } = await pool.query<CheckoutContext>(
    `SELECT m.id AS member_id, m.user_id, u.name AS user_name, u.email AS user_email,
            c.id AS circle_id, c.status AS circle_status,
            c.contribution_amount, c.penalty_pct, c.admin_fee,
            p.id AS period_id, p.period_no, p.status AS period_status, p.due_date
       FROM members m
       JOIN users u   ON u.id = m.user_id
       JOIN circles c ON c.id = m.circle_id
       JOIN periods p ON p.circle_id = c.id
      WHERE m.id = $1 AND c.id = $2 AND p.id = $3`,
    [memberId, circleId, periodId],
  );
  if (!rows[0]) throw notFound("Anggota atau periode untuk kelompok ini");
  return rows[0];
}

/**
 * Checkout iuran. Idempoten:
 * - order PENDING yang masih berlaku dikembalikan apa adanya (token yang sama),
 * - iuran yang sudah lunas ditolak (409),
 * - order PENDING yang kedaluwarsa ditandai EXPIRED lalu dibuatkan order baru.
 * Penalti dan biaya admin di-snapshot saat order dibuat.
 */
export async function createCheckout(
  user: AuthUser,
  input: { circleId: number; periodId: number; memberId: number },
): Promise<CheckoutResult> {
  const ctx = await loadContext(input.circleId, input.periodId, input.memberId);
  if (ctx.user_id !== user.id) {
    throw forbidden("Iuran hanya bisa dibayar oleh anggota yang bersangkutan");
  }
  if (ctx.circle_status !== "active") {
    throw conflict("CIRCLE_NOT_ACTIVE", "Kelompok belum dimulai atau sudah selesai");
  }
  if (ctx.period_status !== "running") {
    throw conflict("PERIOD_NOT_OPEN", "Periode ini tidak sedang menerima iuran");
  }

  const existing = await findActiveOrder(ctx.member_id, ctx.period_id);
  if (existing) {
    if (isPaid(existing.status)) {
      throw conflict("ALREADY_PAID", "Iuran periode ini sudah dibayar");
    }
    const stillValid = existing.snap_token !== null && existing.expires_at.getTime() > Date.now();
    if (stillValid) return toResult(existing, true);

    // Kedaluwarsa atau tidak pernah mendapat token: tutup order lama, buat yang baru.
    const closed = await withTx((client) =>
      transitionOrder(
        client,
        existing.id,
        existing.snap_token ? "EXPIRED" : "FAILED",
        existing.snap_token ? "checkout:expired" : "checkout:no_token",
      ),
    );
    if (closed.outcome === "rejected") {
      // Status berubah di tengah jalan (mis. baru dibayar). Cek ulang.
      const now = await findActiveOrder(ctx.member_id, ctx.period_id);
      if (now && isPaid(now.status)) throw conflict("ALREADY_PAID", "Iuran periode ini sudah dibayar");
      if (now) return toResult(now, true);
    }
  }

  const bill = computeBill({
    contributionAmount: ctx.contribution_amount,
    penaltyPct: ctx.penalty_pct,
    adminFee: ctx.admin_fee,
    dueDate: ctx.due_date,
  });

  const attemptRow = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM orders WHERE member_id = $1 AND period_id = $2",
    [ctx.member_id, ctx.period_id],
  );
  const attempt = attemptRow.rows[0]!.n + 1;
  // order_id Midtrans: unik dan maksimal 50 karakter.
  const orderId = `LP-${ctx.circle_id}-${ctx.period_no}-${ctx.member_id}-${Date.now().toString(36)}`;
  const idempotencyKey = `${ctx.circle_id}:${ctx.period_id}:${ctx.member_id}#${attempt}`;
  const expiresAt = new Date(Date.now() + config.ORDER_EXPIRY_MINUTES * 60_000);

  let orderPk: number;
  try {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO orders
         (order_id, member_id, period_id, amount, penalty_amount, admin_fee, gross_amount,
          idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        orderId,
        ctx.member_id,
        ctx.period_id,
        bill.amount,
        bill.penaltyAmount,
        bill.adminFee,
        bill.grossAmount,
        idempotencyKey,
        expiresAt,
      ],
    );
    orderPk = ins.rows[0]!.id;
  } catch (err) {
    // Dua checkout serentak: yang kalah mengembalikan order yang menang.
    if (isUniqueViolation(err)) {
      const winner = await findActiveOrder(ctx.member_id, ctx.period_id);
      if (winner) return toResult(winner, true);
    }
    throw err;
  }

  try {
    const snap = await createSnapTransaction({
      orderId,
      grossAmount: bill.grossAmount,
      items: billItems(bill),
      customer: { firstName: ctx.user_name, email: ctx.user_email },
      expiryMinutes: config.ORDER_EXPIRY_MINUTES,
      enabledPayments: ENABLED_PAYMENTS,
    });
    const upd = await pool.query<OrderRow>(
      `UPDATE orders SET snap_token = $2, updated_at = now() WHERE id = $1
       RETURNING ${ORDER_COLUMNS}`,
      [orderPk, snap.token],
    );
    return toResult(upd.rows[0]!, false);
  } catch (err) {
    // Gagal membuat token: order ditutup agar anggota bisa mencoba lagi.
    await withTx((client) => transitionOrder(client, orderPk, "FAILED", "checkout:snap_error")).catch(
      () => undefined,
    );
    throw err;
  }
}
