import type { PoolClient } from "pg";
import { pool, withTx } from "../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../lib/errors.js";
import { keccakHex } from "../lib/hash.js";
import type { AuthUser } from "./auth.js";
import { approveIrisPayout, createIrisPayout, irisAvailable, type IrisBeneficiary } from "./iris.js";
import { enqueueMarkPayout, type MarkPayoutPayload } from "./outbox.js";

interface PeriodContext {
  period_id: number;
  period_no: number;
  period_status: string;
  circle_id: number;
  circle_created_by: number;
  chain_circle_id: string | null;
  recipient_member_id: number | null;
  recipient_ref: string | null;
}

interface PayoutRow {
  id: number;
  status: string;
  mode: string;
  amount: number;
  iris_reference_no: string | null;
  payout_ref_hash: string;
}

const PAID = "('SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')";

async function loadPeriod(client: PoolClient, periodId: number): Promise<PeriodContext> {
  const { rows } = await client.query<PeriodContext>(
    `SELECT p.id AS period_id, p.period_no, p.status AS period_status,
            c.id AS circle_id, c.created_by AS circle_created_by, c.chain_circle_id,
            p.recipient_member_id, m.member_ref AS recipient_ref
       FROM periods p
       JOIN circles c ON c.id = p.circle_id
       LEFT JOIN members m ON m.id = p.recipient_member_id
      WHERE p.id = $1
      FOR UPDATE OF p`,
    [periodId],
  );
  if (!rows[0]) throw notFound("Periode");
  return rows[0];
}

/** Periode selesai dicairkan: buka periode berikutnya, atau tutup kelompok bila sudah terakhir. */
async function completePeriod(client: PoolClient, ctx: PeriodContext): Promise<void> {
  await client.query("UPDATE periods SET status = 'done' WHERE id = $1", [ctx.period_id]);
  const next = await client.query(
    `UPDATE periods SET status = 'running'
      WHERE circle_id = $1 AND period_no = $2 AND status = 'scheduled'`,
    [ctx.circle_id, ctx.period_no + 1],
  );
  if (!next.rowCount) {
    await client.query("UPDATE circles SET status = 'completed' WHERE id = $1", [ctx.circle_id]);
  }
}

async function finalize(
  client: PoolClient,
  ctx: PeriodContext,
  payout: { id: number; amount: number; payoutRefHash: string; recipientAccountHash: string | null },
): Promise<void> {
  const payload: MarkPayoutPayload = {
    circleId: ctx.circle_id,
    circleChainId: ctx.chain_circle_id,
    periodNo: ctx.period_no,
    recipientMemberRef: ctx.recipient_ref!,
    payoutRefHash: payout.payoutRefHash,
    recipientAccountHash: payout.recipientAccountHash,
    amount: payout.amount,
  };
  await enqueueMarkPayout(client, payout.id, payload);
  await completePeriod(client, ctx);
}

const toView = (r: PayoutRow) => ({
  id: r.id,
  status: r.status,
  mode: r.mode,
  amount: r.amount,
  irisReferenceNo: r.iris_reference_no,
  payoutRefHash: r.payout_ref_hash,
});

/**
 * Pencairan satu periode ke penerima giliran.
 * Dana pencairan = jumlah iuran + penalti yang terkumpul. Biaya admin adalah pendapatan
 * LingkarPay dan tidak ikut dicairkan.
 *
 * mode "simulated": hanya mencatat (sandbox). mode "iris": memakai Midtrans Iris sandbox.
 * Hanya pembuat kelompok (operator) yang boleh memicu, dan hanya saat periode "ready_payout".
 */
export async function createPayout(
  user: AuthUser,
  input: { periodId: number; mode: "simulated" | "iris"; beneficiary?: IrisBeneficiary },
) {
  if (input.mode === "iris") {
    if (!irisAvailable()) {
      throw new AppError("IRIS_DISABLED", "Iris belum diaktifkan (IRIS_ENABLED dan kunci creator/approver)", 400);
    }
    if (!input.beneficiary) {
      throw new AppError("BENEFICIARY_REQUIRED", "Data penerima (data dummy) wajib untuk mode iris", 400);
    }
  }

  // Tahap 1: validasi dan catat payout di database.
  const stage1 = await withTx(async (client) => {
    const ctx = await loadPeriod(client, input.periodId);
    if (ctx.circle_created_by !== user.id) throw forbidden("Hanya pembuat kelompok yang bisa mencairkan");
    if (ctx.recipient_member_id === null || ctx.recipient_ref === null) {
      throw conflict("NO_RECIPIENT", "Periode belum punya penerima");
    }

    const existing = (
      await client.query<PayoutRow>(
        `SELECT id, status, mode, amount, iris_reference_no, payout_ref_hash
           FROM payouts WHERE period_id = $1`,
        [ctx.period_id],
      )
    ).rows[0];

    // Percobaan ulang Iris: payout sudah dibuat di Iris tetapi approve gagal.
    if (
      existing &&
      input.mode === "iris" &&
      existing.mode === "iris" &&
      (existing.status === "QUEUED" || existing.status === "FAILED") &&
      existing.iris_reference_no
    ) {
      return { ctx, payoutId: existing.id, amount: existing.amount, retry: true as const, existing };
    }
    if (existing && existing.status === "FAILED" && !existing.iris_reference_no) {
      await client.query("DELETE FROM payouts WHERE id = $1", [existing.id]);
    } else if (existing) {
      throw conflict("PAYOUT_EXISTS", "Periode ini sudah dicairkan");
    }

    if (ctx.period_status !== "ready_payout") {
      throw conflict("PERIOD_NOT_READY", "Periode belum siap cair (iuran belum lengkap)");
    }

    const sum = await client.query<{ total: number }>(
      `SELECT COALESCE(sum(amount + penalty_amount), 0) AS total
         FROM orders WHERE period_id = $1 AND status IN ${PAID}`,
      [ctx.period_id],
    );
    const amount = sum.rows[0]!.total;
    if (amount <= 0) throw conflict("NOTHING_TO_PAY", "Tidak ada dana terkumpul untuk dicairkan");

    const payoutRefHash = keccakHex(
      `lingkarpay:v1:payout:${ctx.circle_id}:${ctx.period_no}:${ctx.recipient_ref}:${amount}`,
    );
    const accountHash =
      input.mode === "iris" && input.beneficiary
        ? keccakHex(`${input.beneficiary.bank}:${input.beneficiary.account}`)
        : null;

    const ins = await client.query<{ id: number }>(
      `INSERT INTO payouts
         (period_id, recipient_member_id, amount, mode, status, recipient_account_hash, payout_ref_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        ctx.period_id,
        ctx.recipient_member_id,
        amount,
        input.mode,
        input.mode === "simulated" ? "SIMULATED" : "QUEUED",
        accountHash,
        payoutRefHash,
      ],
    );
    const payoutId = ins.rows[0]!.id;

    if (input.mode === "simulated") {
      await finalize(client, ctx, { id: payoutId, amount, payoutRefHash, recipientAccountHash: null });
    }
    return { ctx, payoutId, amount, retry: false as const, payoutRefHash, accountHash };
  });

  if (input.mode === "simulated") return getPayout(stage1.payoutId);

  // Tahap 2 (Iris): panggil Iris di luar transaksi database.
  const beneficiary = input.beneficiary!;
  let reference: string | null = stage1.retry ? stage1.existing.iris_reference_no : null;
  try {
    if (!reference) {
      reference = await createIrisPayout(
        beneficiary,
        stage1.amount,
        `LingkarPay periode ${stage1.ctx.period_no}`,
        `lingkarpay-payout-${stage1.payoutId}`,
      );
      await pool.query(
        "UPDATE payouts SET iris_reference_no = $2, updated_at = now() WHERE id = $1",
        [stage1.payoutId, reference],
      );
    }
    await approveIrisPayout(reference);
  } catch (err) {
    await pool.query("UPDATE payouts SET status = 'FAILED', updated_at = now() WHERE id = $1", [
      stage1.payoutId,
    ]);
    throw err;
  }

  await withTx(async (client) => {
    await client.query("UPDATE payouts SET status = 'APPROVED', updated_at = now() WHERE id = $1", [
      stage1.payoutId,
    ]);
    const row = (
      await client.query<{ payout_ref_hash: string; recipient_account_hash: string | null; amount: number }>(
        "SELECT payout_ref_hash, recipient_account_hash, amount FROM payouts WHERE id = $1",
        [stage1.payoutId],
      )
    ).rows[0]!;
    await finalize(client, stage1.ctx, {
      id: stage1.payoutId,
      amount: row.amount,
      payoutRefHash: row.payout_ref_hash,
      recipientAccountHash: row.recipient_account_hash,
    });
  });
  return getPayout(stage1.payoutId);
}

async function getPayout(id: number) {
  const { rows } = await pool.query<PayoutRow>(
    `SELECT id, status, mode, amount, iris_reference_no, payout_ref_hash FROM payouts WHERE id = $1`,
    [id],
  );
  return toView(rows[0]!);
}
