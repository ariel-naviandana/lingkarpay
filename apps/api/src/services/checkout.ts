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
  /** null untuk setoran jaminan (tidak terikat periode). */
  period_id: number | null;
  period_no: number | null;
  period_status: string | null;
  due_date: Date | null;
}

/** Setoran jaminan: jumlah tetap, tanpa penalti dan tanpa biaya admin (dana dikembalikan di akhir). */
interface DepositBill {
  kind: "deposit";
  amount: number;
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

async function findActiveOrder(memberId: number, periodId: number | null): Promise<OrderRow | null> {
  // periodId null = order setoran jaminan anggota ini.
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE member_id = $1 AND period_id IS NOT DISTINCT FROM $2::int AND status = ANY($3::text[])`,
    [memberId, periodId, ACTIVE_STATUSES],
  );
  return rows[0] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Menunggu order PENDING mendapat token (order sedang dibuat oleh permintaan lain). */
async function waitForToken(orderPk: number, timeoutMs: number): Promise<OrderRow | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`,
      [orderPk],
    );
    const row = rows[0] ?? null;
    if (!row || row.snap_token || row.status !== "PENDING" || Date.now() >= deadline) return row;
    await sleep(200);
  }
}

/**
 * Order aktif milik anggota di periode ini. Bila masih PENDING tanpa token, berarti permintaan
 * lain sedang membuatnya: tunggu, jangan ditutup (menutupnya akan membuat pembayaran sah ditolak).
 */
async function resolveExisting(memberId: number, periodId: number | null): Promise<OrderRow | null> {
  const found = await findActiveOrder(memberId, periodId);
  if (found && found.status === "PENDING" && !found.snap_token) {
    const waited = await waitForToken(found.id, 10_000);
    return waited && ACTIVE_STATUSES.includes(waited.status) ? waited : null;
  }
  return found;
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
    throw conflict(
      "CIRCLE_NOT_ACTIVE",
      ctx.circle_status === "draft"
        ? "Kelompok ini belum dimulai oleh pengelola"
        : "Kelompok sudah selesai",
    );
  }
  if (ctx.period_status !== "running") {
    throw conflict(
      "PERIOD_NOT_OPEN",
      ctx.period_status === "ready_payout"
        ? "Periode ini sudah ditutup untuk pencairan dan tidak lagi menerima iuran baru"
        : ctx.period_status === "done"
        ? "Periode ini sudah selesai"
        : "Periode ini tidak sedang menerima iuran",
    );
  }

  return issueOrder(ctx);
}

/**
 * Pelunasan tunggakan (iuran periode yang sudah ditutup lewat kuorum). Hanya penunggaknya sendiri.
 * Tagihannya iuran + penalti keterlambatan + biaya admin; setelah lunas, iuran dan penalti
 * diteruskan ke penerima periode itu.
 */
export async function createArrearsCheckout(user: AuthUser, arrearId: number): Promise<CheckoutResult> {
  const { rows } = await pool.query<CheckoutContext & { arrear_status: string }>(
    `SELECT m.id AS member_id, m.user_id, u.name AS user_name, u.email AS user_email,
            c.id AS circle_id, c.status AS circle_status,
            c.contribution_amount, c.penalty_pct, c.admin_fee,
            p.id AS period_id, p.period_no, p.status AS period_status, p.due_date,
            a.status AS arrear_status
       FROM arrears a
       JOIN members m ON m.id = a.debtor_member_id
       JOIN users u   ON u.id = m.user_id
       JOIN circles c ON c.id = a.circle_id
       JOIN periods p ON p.id = a.period_id
      WHERE a.id = $1`,
    [arrearId],
  );
  const ctx = rows[0];
  if (!ctx) throw notFound("Tunggakan");
  if (ctx.user_id !== user.id) throw forbidden("Tunggakan hanya bisa dilunasi oleh penunggaknya sendiri");
  if (ctx.arrear_status !== "open") throw conflict("ARREAR_SETTLED", "Tunggakan ini sudah lunas");
  return issueOrder(ctx);
}

/**
 * Setoran dana jaminan oleh anggota sendiri, saat kelompok masih draft. Jaminan = satu iuran + penalti
 * keterlambatan, cukup untuk menutup satu tunggakan. Tanpa biaya admin karena dikembalikan di akhir.
 */
export async function createDepositCheckout(user: AuthUser, circleId: number): Promise<CheckoutResult> {
  const { rows } = await pool.query<CheckoutContext & { deposit_amount: number; has_deposit: boolean }>(
    `SELECT m.id AS member_id, m.user_id, u.name AS user_name, u.email AS user_email,
            c.id AS circle_id, c.status AS circle_status,
            c.contribution_amount, c.penalty_pct, c.admin_fee, c.deposit_amount,
            NULL::int AS period_id, NULL::int AS period_no, NULL::text AS period_status, NULL::timestamptz AS due_date,
            EXISTS (SELECT 1 FROM deposits d WHERE d.member_id = m.id) AS has_deposit
       FROM members m
       JOIN users u   ON u.id = m.user_id
       JOIN circles c ON c.id = m.circle_id
      WHERE c.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [circleId, user.id],
  );
  const ctx = rows[0];
  if (!ctx) throw forbidden("Kamu bukan anggota kelompok ini");
  if (Number(ctx.deposit_amount) <= 0) throw conflict("DEPOSIT_NOT_REQUIRED", "Kelompok ini tidak memakai dana jaminan");
  if (ctx.circle_status !== "draft") {
    throw conflict("CIRCLE_STARTED", "Jaminan disetor sebelum kelompok dikunci");
  }
  if (ctx.has_deposit) throw conflict("ALREADY_PAID", "Dana jaminan Anda sudah disetor");
  return issueOrder(ctx, { kind: "deposit", amount: Number(ctx.deposit_amount) });
}

/** Membuat (atau memakai ulang) order untuk anggota dan periode pada ctx, lalu token Snap. */
async function issueOrder(ctx: CheckoutContext, deposit?: DepositBill): Promise<CheckoutResult> {
  const existing = await resolveExisting(ctx.member_id, ctx.period_id);
  if (existing) {
    if (isPaid(existing.status)) {
      throw conflict("ALREADY_PAID", deposit ? "Dana jaminan Anda sudah disetor" : "Iuran periode ini sudah dibayar");
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
      if (now && isPaid(now.status)) throw conflict("ALREADY_PAID", "Pembayaran ini sudah lunas");
      if (now) return toResult(now, true);
    }
  }

  const bill = deposit
    ? { amount: deposit.amount, penaltyAmount: 0, adminFee: 0, grossAmount: deposit.amount, overdue: false }
    : computeBill({
        contributionAmount: ctx.contribution_amount,
        penaltyPct: ctx.penalty_pct,
        adminFee: ctx.admin_fee,
        dueDate: ctx.due_date!,
      });

  const attemptRow = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM orders WHERE member_id = $1 AND period_id IS NOT DISTINCT FROM $2::int",
    [ctx.member_id, ctx.period_id],
  );
  const attempt = attemptRow.rows[0]!.n + 1;
  // order_id Midtrans: unik dan maksimal 50 karakter. "J" = setoran jaminan.
  const orderId = `LP-${ctx.circle_id}-${deposit ? "J" : ctx.period_no}-${ctx.member_id}-${Date.now().toString(36)}`;
  const idempotencyKey = `${ctx.circle_id}:${deposit ? "deposit" : ctx.period_id}:${ctx.member_id}#${attempt}`;
  const expiresAt = new Date(Date.now() + config.ORDER_EXPIRY_MINUTES * 60_000);

  let orderPk: number;
  try {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO orders
         (order_id, member_id, period_id, amount, penalty_amount, admin_fee, gross_amount,
          idempotency_key, expires_at, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
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
        deposit ? "deposit" : "contribution",
      ],
    );
    orderPk = ins.rows[0]!.id;
  } catch (err) {
    // Dua checkout serentak: yang kalah mengembalikan order yang menang.
    if (isUniqueViolation(err)) {
      const winner = await findActiveOrder(ctx.member_id, ctx.period_id);
      if (winner) {
        const ready = winner.snap_token ? winner : ((await waitForToken(winner.id, 10_000)) ?? winner);
        return toResult(ready, true);
      }
    }
    throw err;
  }

  try {
    const snap = await createSnapTransaction({
      orderId,
      grossAmount: bill.grossAmount,
      items: deposit ? [{ id: "jaminan", name: "Dana jaminan arisan", price: bill.amount, quantity: 1 }] : billItems(bill),
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
