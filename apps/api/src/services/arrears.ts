/**
 * Tunggakan (iuran yang tidak dibayar saat periode ditutup lewat kuorum).
 *
 * Aturan bisnis:
 * - Saat kuorum menutup periode, setiap anggota yang belum membayar (kecuali penerima periode itu)
 *   tercatat menunggak sebesar satu iuran. Kreditornya = penerima periode itu (yang menerima kurang).
 * - Penunggak boleh melunasi kapan saja lewat pembayaran susulan (iuran + penalti + biaya admin).
 * - Bila belum lunas saat gilirannya menerima, tunggakan (iuran + penalti) dipotong dari jatahnya.
 * - Setiap pelunasan diteruskan ke kreditor sebagai transfer simulasi ke rekening kreditor.
 *
 * Catatan chain: pelunasan susulan tidak dicatat ke contract (contract v2 hanya menerima pembayaran
 * saat periode berjalan), sehingga di chain periode itu tetap tercatat kurang bayar, sesuai kenyataan.
 */
import type { PoolClient } from "pg";
import { pool, type Db } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import { computePenalty } from "./billing.js";
import { destinationView, type PayoutAccountView } from "./payoutAccount.js";

const PAID = "('SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')";

/** Nomor referensi transfer simulasi untuk penerusan tunggakan. */
const forwardRef = (arrearId: number, at: Date) =>
  `SIM-TRF-${at.toISOString().slice(0, 10).replace(/-/g, "")}-A${arrearId}`;

/**
 * Mencatat tunggakan untuk periode yang baru ditutup lewat kuorum.
 * Penerima periode tidak dicatat menunggak kepada dirinya sendiri. Idempoten.
 */
export async function createArrearsForClosedPeriod(db: Db, periodId: number): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO arrears (circle_id, period_id, debtor_member_id, creditor_member_id, amount)
     SELECT c.id, p.id, m.id, p.recipient_member_id, c.contribution_amount
       FROM periods p
       JOIN circles c ON c.id = p.circle_id
       JOIN members m ON m.circle_id = c.id AND m.status = 'active'
      WHERE p.id = $1
        AND p.recipient_member_id IS NOT NULL
        AND m.id <> p.recipient_member_id
        AND NOT EXISTS (SELECT 1 FROM orders o
                         WHERE o.period_id = p.id AND o.member_id = m.id AND o.status IN ${PAID})
     ON CONFLICT (period_id, debtor_member_id) DO NOTHING`,
    [periodId],
  );
  return rowCount ?? 0;
}

interface CreditorAccount {
  payout_channel: string | null;
  payout_account_last4: string | null;
  payout_account_name: string | null;
}

/** Mencatat penerusan dana tunggakan ke kreditor (transfer simulasi ke rekening kreditor). */
async function forward(client: PoolClient, arrearId: number, creditorMemberId: number, amount: number) {
  const acct = (
    await client.query<CreditorAccount>(
      "SELECT payout_channel, payout_account_last4, payout_account_name FROM members WHERE id = $1",
      [creditorMemberId],
    )
  ).rows[0];
  const now = new Date();
  const hasAccount = !!(acct?.payout_channel && acct.payout_account_last4 && acct.payout_account_name);
  await client.query(
    `UPDATE arrears
        SET forward_amount = $2, forward_channel = $3, forward_last4 = $4, forward_name = $5,
            forward_ref = $6, forwarded_at = $7
      WHERE id = $1`,
    [
      arrearId,
      amount,
      hasAccount ? acct!.payout_channel : null,
      hasAccount ? acct!.payout_account_last4 : null,
      hasAccount ? acct!.payout_account_name : null,
      hasAccount ? forwardRef(arrearId, now) : null,
      hasAccount ? now : null,
    ],
  );
}

/**
 * Bila order lunas ini milik penunggak untuk periode yang tunggakannya masih terbuka,
 * tandai tunggakan lunas dan teruskan dananya ke kreditor. Mengembalikan true bila ya
 * (pemanggil tidak mencatat order ini ke contract dan tidak menghitung kesiapan periode).
 */
export async function settleArrearByOrder(client: PoolClient, orderPk: number): Promise<boolean> {
  const { rows } = await client.query<{
    id: number;
    creditor_member_id: number;
    amount: number;
    penalty_amount: number;
  }>(
    `SELECT a.id, a.creditor_member_id, o.amount, o.penalty_amount
       FROM orders o
       JOIN arrears a ON a.period_id = o.period_id AND a.debtor_member_id = o.member_id
      WHERE o.id = $1 AND a.status = 'open'
      FOR UPDATE OF a`,
    [orderPk],
  );
  const a = rows[0];
  if (!a) return false;
  await client.query(
    `UPDATE arrears SET status = 'paid', penalty_amount = $2, settled_order_id = $3, settled_at = now()
      WHERE id = $1`,
    [a.id, a.penalty_amount, orderPk],
  );
  await forward(client, a.id, a.creditor_member_id, Number(a.amount) + Number(a.penalty_amount));
  return true;
}

export interface ArrearsDeduction {
  arrearId: number;
  amount: number;
  penalty: number;
  creditorMemberId: number;
}

/**
 * Rencana potongan tunggakan dari jatah penerima (dikunci untuk transaksi ini).
 * Tunggakan dipotong berurutan selama jatah bersih tetap lebih dari nol; sisanya tetap terbuka.
 */
export async function planArrearsDeduction(
  client: PoolClient,
  recipientMemberId: number,
  available: number,
  now: Date = new Date(),
): Promise<ArrearsDeduction[]> {
  const { rows } = await client.query<{
    id: number;
    amount: number;
    creditor_member_id: number;
    contribution_amount: number;
    penalty_pct: number;
    due_date: Date;
  }>(
    `SELECT a.id, a.amount, a.creditor_member_id, c.contribution_amount, c.penalty_pct, p.due_date
       FROM arrears a
       JOIN periods p ON p.id = a.period_id
       JOIN circles c ON c.id = a.circle_id
      WHERE a.debtor_member_id = $1 AND a.status = 'open'
      ORDER BY p.period_no
      FOR UPDATE OF a`,
    [recipientMemberId],
  );
  const plan: ArrearsDeduction[] = [];
  let remaining = available;
  for (const r of rows) {
    const penalty = computePenalty(Number(r.contribution_amount), r.penalty_pct, r.due_date, now);
    const due = Number(r.amount) + penalty;
    if (remaining - due < 1) break;
    plan.push({ arrearId: r.id, amount: Number(r.amount), penalty, creditorMemberId: r.creditor_member_id });
    remaining -= due;
  }
  return plan;
}

/** Menerapkan potongan: tunggakan menjadi 'deducted' dan dananya diteruskan ke kreditor. */
export async function applyArrearsDeduction(client: PoolClient, plan: ArrearsDeduction[], payoutId: number) {
  for (const d of plan) {
    await client.query(
      `UPDATE arrears SET status = 'deducted', penalty_amount = $2, settled_payout_id = $3, settled_at = now()
        WHERE id = $1`,
      [d.arrearId, d.penalty, payoutId],
    );
    await forward(client, d.arrearId, d.creditorMemberId, d.amount + d.penalty);
  }
}

export interface ArrearView {
  id: number;
  periodNo: number;
  debtorMemberId: number;
  debtorName: string;
  debtorRef: string;
  creditorMemberId: number;
  creditorName: string;
  amount: number;
  /** Penalti: perkiraan saat ini bila masih terbuka, atau yang dibayarkan bila sudah lunas. */
  penaltyAmount: number;
  totalDue: number;
  status: "open" | "paid" | "deducted";
  settledAt: Date | null;
  settledPayoutPeriodNo: number | null;
  forward: {
    amount: number;
    destination: PayoutAccountView | null;
    transferRef: string | null;
    forwardedAt: Date | null;
  } | null;
}

/** Semua tunggakan satu kelompok (terbuka untuk anggota: transparansi). */
export async function listArrears(circleId: number, now: Date = new Date()): Promise<ArrearView[]> {
  const { rows } = await pool.query<{
    id: number;
    period_no: number;
    debtor_member_id: number;
    debtor_name: string;
    debtor_ref: string;
    creditor_member_id: number;
    creditor_name: string;
    amount: number;
    penalty_amount: number;
    status: "open" | "paid" | "deducted";
    settled_at: Date | null;
    payout_period_no: number | null;
    forward_amount: number | null;
    forward_channel: string | null;
    forward_last4: string | null;
    forward_name: string | null;
    forward_ref: string | null;
    forwarded_at: Date | null;
    contribution_amount: number;
    penalty_pct: number;
    due_date: Date;
  }>(
    `SELECT a.id, p.period_no, a.debtor_member_id, du.name AS debtor_name, dm.member_ref AS debtor_ref,
            a.creditor_member_id, cu.name AS creditor_name, a.amount, a.penalty_amount, a.status,
            a.settled_at, pp.period_no AS payout_period_no,
            a.forward_amount, a.forward_channel, a.forward_last4, a.forward_name, a.forward_ref, a.forwarded_at,
            c.contribution_amount, c.penalty_pct, p.due_date
       FROM arrears a
       JOIN periods p ON p.id = a.period_id
       JOIN circles c ON c.id = a.circle_id
       JOIN members dm ON dm.id = a.debtor_member_id
       JOIN users du ON du.id = dm.user_id
       JOIN members cm ON cm.id = a.creditor_member_id
       JOIN users cu ON cu.id = cm.user_id
       LEFT JOIN payouts po ON po.id = a.settled_payout_id
       LEFT JOIN periods pp ON pp.id = po.period_id
      WHERE a.circle_id = $1
      ORDER BY p.period_no, a.id`,
    [circleId],
  );
  return rows.map((r) => {
    const penalty =
      r.status === "open"
        ? computePenalty(Number(r.contribution_amount), r.penalty_pct, r.due_date, now)
        : Number(r.penalty_amount);
    return {
      id: r.id,
      periodNo: r.period_no,
      debtorMemberId: r.debtor_member_id,
      debtorName: r.debtor_name,
      debtorRef: r.debtor_ref,
      creditorMemberId: r.creditor_member_id,
      creditorName: r.creditor_name,
      amount: Number(r.amount),
      penaltyAmount: penalty,
      totalDue: Number(r.amount) + penalty,
      status: r.status,
      settledAt: r.settled_at,
      settledPayoutPeriodNo: r.payout_period_no,
      forward:
        r.forward_amount !== null
          ? {
              amount: Number(r.forward_amount),
              destination:
                r.forward_channel && r.forward_last4 && r.forward_name
                  ? destinationView(r.forward_channel, r.forward_last4, r.forward_name)
                  : null,
              transferRef: r.forward_ref,
              forwardedAt: r.forwarded_at,
            }
          : null,
    };
  });
}

/**
 * Sanksi penunggak: selama masih punya tunggakan terbuka di kelompok mana pun, pengguna tidak
 * boleh membuat kelompok baru atau menerima undangan baru. Tunggakan tetap bisa dilunasi kapan saja.
 */
export async function assertNoOpenArrears(db: Db, userId: number): Promise<void> {
  const { rows } = await db.query<{ n: number; total: number; circles: string | null }>(
    `SELECT count(*)::int AS n, COALESCE(sum(a.amount), 0)::bigint AS total,
            string_agg(DISTINCT c.name, ', ') AS circles
       FROM arrears a
       JOIN members m ON m.id = a.debtor_member_id
       JOIN circles c ON c.id = a.circle_id
      WHERE m.user_id = $1 AND a.status = 'open'`,
    [userId],
  );
  const r = rows[0]!;
  if (r.n > 0) {
    throw new AppError(
      "HAS_OPEN_ARREARS",
      `Anda masih punya ${r.n} tunggakan (iuran Rp${Number(r.total).toLocaleString("id-ID")} belum termasuk penalti) di ${r.circles}. ` +
        "Lunasi dulu sebelum membuat atau bergabung ke kelompok baru.",
      409,
    );
  }
}

/** SQL: order ini pelunasan tunggakan (tidak dihitung sebagai iuran periode berjalan). */
export const IS_ARREARS_ORDER = (alias: string) =>
  `EXISTS (SELECT 1 FROM arrears ax WHERE ax.settled_order_id = ${alias}.id)`;
