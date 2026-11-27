/**
 * Dana jaminan (deposit) anggota.
 *
 * Aturan bisnis:
 * - Setiap anggota (termasuk pembuat) menyetor jaminan sebelum kelompok dikunci. Besarnya satu iuran
 *   ditambah penalti keterlambatan, cukup untuk menutup satu tunggakan. Tanpa biaya admin.
 * - Tunggakan yang masih bisa dipotong dari jatah giliran penunggak tetap dipotong dari jatah itu.
 *   Jaminan hanya dipakai bila giliran penunggak sudah lewat (sudah menerima lalu berhenti bayar),
 *   atau saat kelompok selesai dan masih ada tunggakan terbuka. Dananya diteruskan ke kreditor.
 * - Saat kelompok selesai atau dibatalkan, sisa jaminan dikembalikan ke rekening pencairan anggota
 *   (transfer simulasi).
 * Jaminan dicatat off-chain (contract v2 tidak mengenal jaminan).
 */
import type { PoolClient } from "pg";
import { pool, type Db } from "../db/pool.js";
import { computePenalty } from "./billing.js";
import { destinationView, type PayoutAccountView } from "./payoutAccount.js";

/** Besar jaminan untuk aturan kelompok: satu iuran + penalti keterlambatan. */
export const depositAmountFor = (contributionAmount: number, penaltyPct: number) =>
  contributionAmount + computePenalty(contributionAmount, penaltyPct, new Date(0), new Date(1));

const refundRef = (circleId: number, memberId: number, at: Date) =>
  `SIM-TRF-${at.toISOString().slice(0, 10).replace(/-/g, "")}-J${circleId}-${memberId}`;
const forwardRef = (arrearId: number, at: Date) =>
  `SIM-TRF-${at.toISOString().slice(0, 10).replace(/-/g, "")}-A${arrearId}`;

/**
 * Bila order lunas ini setoran jaminan, catat jaminannya. Mengembalikan true bila ya (pemanggil tidak
 * mencatatnya ke contract). Bila kelompok sudah dibatalkan, jaminan langsung dikembalikan. Idempoten.
 */
export async function settleDepositByOrder(client: PoolClient, orderPk: number): Promise<boolean> {
  const { rows } = await client.query<{ member_id: number; circle_id: number; amount: number; circle_status: string }>(
    `SELECT o.member_id, m.circle_id, o.amount, c.status AS circle_status
       FROM orders o
       JOIN members m ON m.id = o.member_id
       JOIN circles c ON c.id = m.circle_id
      WHERE o.id = $1 AND o.kind = 'deposit'`,
    [orderPk],
  );
  const o = rows[0];
  if (!o) return false;
  await client.query(
    `INSERT INTO deposits (member_id, circle_id, order_id, amount, paid_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (member_id) DO NOTHING`,
    [o.member_id, o.circle_id, orderPk, o.amount],
  );
  if (o.circle_status === "cancelled") await refundDeposits(client, o.circle_id);
  return true;
}

/** Anggota aktif kelompok draft yang belum menyetor jaminan (bila kelompok memakai jaminan). */
export async function membersWithoutDeposit(db: Db, circleId: number): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT u.name
       FROM members m
       JOIN users u ON u.id = m.user_id
       JOIN circles c ON c.id = m.circle_id
      WHERE m.circle_id = $1 AND m.status = 'active' AND c.deposit_amount > 0
        AND NOT EXISTS (SELECT 1 FROM deposits d WHERE d.member_id = m.id)
      ORDER BY m.id`,
    [circleId],
  );
  return rows.map((r) => r.name);
}

/**
 * Menutup tunggakan terbuka dari jaminan penunggak. Bila `all` false, hanya penunggak yang gilirannya
 * sudah dicairkan (tunggakannya tidak bisa lagi dipotong dari jatah). Satu tunggakan ditutup hanya bila
 * sisa jaminan cukup untuk seluruhnya (iuran + penalti). Mengembalikan jumlah tunggakan yang ditutup.
 */
export async function coverArrearsFromDeposits(
  client: PoolClient,
  circleId: number,
  opts: { all: boolean },
  now: Date = new Date(),
): Promise<number> {
  const { rows } = await client.query<{
    id: number;
    amount: number;
    debtor_member_id: number;
    creditor_member_id: number;
    contribution_amount: number;
    penalty_pct: number;
    due_date: Date;
  }>(
    `SELECT a.id, a.amount, a.debtor_member_id, a.creditor_member_id,
            c.contribution_amount, c.penalty_pct, p.due_date
       FROM arrears a
       JOIN periods p ON p.id = a.period_id
       JOIN circles c ON c.id = a.circle_id
       JOIN deposits d ON d.member_id = a.debtor_member_id AND d.status = 'held'
      WHERE a.circle_id = $1 AND a.status = 'open'
        AND ($2::boolean OR EXISTS (SELECT 1 FROM periods tp
                                      WHERE tp.recipient_member_id = a.debtor_member_id AND tp.status = 'done'))
      ORDER BY p.period_no, a.id
      FOR UPDATE OF a`,
    [circleId, opts.all],
  );
  let covered = 0;
  for (const r of rows) {
    const penalty = computePenalty(Number(r.contribution_amount), r.penalty_pct, r.due_date, now);
    const due = Number(r.amount) + penalty;
    const take = await client.query(
      `UPDATE deposits SET used_amount = used_amount + $2
        WHERE member_id = $1 AND status = 'held' AND amount - used_amount >= $2`,
      [r.debtor_member_id, due],
    );
    if (!take.rowCount) continue;
    const acct = (
      await client.query<{ payout_channel: string | null; payout_account_last4: string | null; payout_account_name: string | null }>(
        "SELECT payout_channel, payout_account_last4, payout_account_name FROM members WHERE id = $1",
        [r.creditor_member_id],
      )
    ).rows[0];
    const ok = !!(acct?.payout_channel && acct.payout_account_last4 && acct.payout_account_name);
    await client.query(
      `UPDATE arrears
          SET status = 'covered', penalty_amount = $2, settled_at = $3,
              forward_amount = $4, forward_channel = $5, forward_last4 = $6, forward_name = $7,
              forward_ref = $8, forwarded_at = $9
        WHERE id = $1`,
      [
        r.id,
        penalty,
        now,
        due,
        ok ? acct!.payout_channel : null,
        ok ? acct!.payout_account_last4 : null,
        ok ? acct!.payout_account_name : null,
        ok ? forwardRef(r.id, now) : null,
        ok ? now : null,
      ],
    );
    covered++;
  }
  return covered;
}

/** Mengembalikan sisa jaminan semua anggota kelompok ke rekening pencairan masing-masing (simulasi). */
export async function refundDeposits(client: PoolClient, circleId: number, now: Date = new Date()): Promise<number> {
  const { rows } = await client.query<{
    member_id: number;
    remaining: number;
    payout_channel: string | null;
    payout_account_last4: string | null;
    payout_account_name: string | null;
  }>(
    `SELECT d.member_id, (d.amount - d.used_amount) AS remaining,
            m.payout_channel, m.payout_account_last4, m.payout_account_name
       FROM deposits d JOIN members m ON m.id = d.member_id
      WHERE d.circle_id = $1 AND d.status = 'held'
      FOR UPDATE OF d`,
    [circleId],
  );
  for (const r of rows) {
    const ok = !!(r.payout_channel && r.payout_account_last4 && r.payout_account_name);
    const remaining = Number(r.remaining);
    await client.query(
      `UPDATE deposits
          SET status = 'refunded', refund_amount = $2, refund_channel = $3, refund_last4 = $4,
              refund_name = $5, refund_ref = $6, refunded_at = $7
        WHERE member_id = $1`,
      [
        r.member_id,
        remaining,
        ok ? r.payout_channel : null,
        ok ? r.payout_account_last4 : null,
        ok ? r.payout_account_name : null,
        ok && remaining > 0 ? refundRef(circleId, r.member_id, now) : null,
        now,
      ],
    );
  }
  return rows.length;
}

export interface DepositView {
  memberId: number;
  status: "held" | "refunded";
  amount: number;
  usedAmount: number;
  paidAt: Date;
  refund: { amount: number; destination: PayoutAccountView | null; transferRef: string | null; refundedAt: Date | null } | null;
}

/** Jaminan semua anggota satu kelompok (status terbuka untuk anggota: transparansi). */
export async function listDeposits(circleId: number): Promise<DepositView[]> {
  const { rows } = await pool.query<{
    member_id: number;
    status: "held" | "refunded";
    amount: number;
    used_amount: number;
    paid_at: Date;
    refund_amount: number | null;
    refund_channel: string | null;
    refund_last4: string | null;
    refund_name: string | null;
    refund_ref: string | null;
    refunded_at: Date | null;
  }>(
    `SELECT member_id, status, amount, used_amount, paid_at, refund_amount, refund_channel, refund_last4,
            refund_name, refund_ref, refunded_at
       FROM deposits WHERE circle_id = $1`,
    [circleId],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    status: r.status,
    amount: Number(r.amount),
    usedAmount: Number(r.used_amount),
    paidAt: r.paid_at,
    refund:
      r.status === "refunded"
        ? {
            amount: Number(r.refund_amount ?? 0),
            destination:
              r.refund_channel && r.refund_last4 && r.refund_name
                ? destinationView(r.refund_channel, r.refund_last4, r.refund_name)
                : null,
            transferRef: r.refund_ref,
            refundedAt: r.refunded_at,
          }
        : null,
  }));
}
