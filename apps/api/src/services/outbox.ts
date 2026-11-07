import { pool, withTx, type Db } from "../db/pool.js";
import { notFound } from "../lib/errors.js";
import { keccakHex } from "../lib/hash.js";
import { transitionOrder } from "./orderStatus.js";

/**
 * Outbox = antarmuka ke modul chain (jalur smart contract).
 *
 * Backend menulis satu baris chain_jobs per kejadian yang harus dicatat on-chain.
 * Modul chain memakai fungsi di bawah (claimJobs → kirim tx → markJobConfirmed / markJobFailed).
 * Payload sengaja minimal dan tanpa data pribadi.
 */
export const MAX_JOB_ATTEMPTS = 5;
const STALE_SENT_SECONDS = 300;

export interface RecordPaymentPayload {
  circleId: number;
  circleChainId: string | null;
  periodNo: number;
  memberRef: string;
  /** Keccak-256 ringkasan transaksi gateway (tanpa data pribadi). */
  refHash: string;
  /** Waktu bayar, detik UNIX. */
  paidAt: number;
}

export interface MarkPayoutPayload {
  circleId: number;
  circleChainId: string | null;
  periodNo: number;
  recipientMemberRef: string;
  payoutRefHash: string;
  /** Keccak-256 rekening penerima (null pada simulasi tanpa rekening). */
  recipientAccountHash: string | null;
  amount: number;
}

export interface ChainJob {
  id: number;
  kind: "recordPayment" | "markPayout";
  orderId: number | null;
  payoutId: number | null;
  payload: RecordPaymentPayload | MarkPayoutPayload;
  attempts: number;
}

/** Dipanggil di dalam transaksi webhook saat order menjadi SETTLED. Satu order, satu job. */
export async function enqueueRecordPayment(db: Db, orderPk: number): Promise<number | null> {
  const { rows } = await db.query<{
    order_id: string;
    gateway_ref: string | null;
    gross_amount: number;
    paid_at: Date | null;
    member_ref: string;
    period_no: number;
    circle_id: number;
    chain_circle_id: string | null;
  }>(
    `SELECT o.order_id, o.gateway_ref, o.gross_amount, o.paid_at,
            m.member_ref, p.period_no, c.id AS circle_id, c.chain_circle_id
       FROM orders o
       JOIN members m ON m.id = o.member_id
       JOIN periods p ON p.id = o.period_id
       JOIN circles c ON c.id = p.circle_id
      WHERE o.id = $1`,
    [orderPk],
  );
  const r = rows[0];
  if (!r) throw notFound("Order");

  const payload: RecordPaymentPayload = {
    circleId: r.circle_id,
    circleChainId: r.chain_circle_id,
    periodNo: r.period_no,
    memberRef: r.member_ref,
    refHash: keccakHex(`lingkarpay:v1:${r.order_id}:${r.gateway_ref ?? ""}:${r.gross_amount}`),
    paidAt: Math.floor((r.paid_at ?? new Date()).getTime() / 1000),
  };
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, order_id, payload)
     VALUES ('recordPayment', $1, $2)
     ON CONFLICT (kind, order_id) WHERE order_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [orderPk, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
}

/** Dipanggil saat payout dibuat. Satu payout, satu job. */
export async function enqueueMarkPayout(
  db: Db,
  payoutId: number,
  payload: MarkPayoutPayload,
): Promise<number | null> {
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, payout_id, payload)
     VALUES ('markPayout', $1, $2)
     ON CONFLICT (kind, payout_id) WHERE payout_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [payoutId, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
}

/**
 * Untuk modul chain: ambil job yang siap diproses dan tandai "sent".
 * Aman dipanggil paralel (FOR UPDATE SKIP LOCKED). Job "sent" yang macet > 5 menit
 * (worker mati) diambil ulang.
 */
export async function claimJobs(limit = 10): Promise<ChainJob[]> {
  const { rows } = await pool.query<{
    id: number;
    kind: ChainJob["kind"];
    order_id: number | null;
    payout_id: number | null;
    payload: ChainJob["payload"];
    attempts: number;
  }>(
    `UPDATE chain_jobs
        SET status = 'sent', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM chain_jobs
         WHERE (status = 'queued' AND next_attempt_at <= now())
            OR (status = 'sent' AND updated_at < now() - make_interval(secs => $2::double precision))
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, order_id, payout_id, payload, attempts`,
    [limit, STALE_SENT_SECONDS],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    orderId: r.order_id,
    payoutId: r.payout_id,
    payload: r.payload,
    attempts: r.attempts,
  }));
}

/** Transaksi terkonfirmasi di chain. Order recordPayment menjadi ANCHORED. Idempoten. */
export async function markJobConfirmed(jobId: number, txHash: string): Promise<void> {
  await withTx(async (client) => {
    const { rows } = await client.query<{
      id: number;
      kind: ChainJob["kind"];
      order_id: number | null;
      status: string;
      attempts: number;
      payload: Record<string, unknown>;
    }>("SELECT id, kind, order_id, status, attempts, payload FROM chain_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = rows[0];
    if (!job) throw notFound("Job chain");
    if (job.status === "confirmed") return;

    await client.query(
      "UPDATE chain_jobs SET status = 'confirmed', last_error = NULL, updated_at = now() WHERE id = $1",
      [jobId],
    );
    const refHash = String(job.payload.refHash ?? job.payload.payoutRefHash ?? "") || null;
    await client.query(
      `INSERT INTO chain_transactions (job_id, tx_hash, ref_hash, status, attempts, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', $4, now())`,
      [jobId, txHash, refHash, job.attempts],
    );
    if (job.kind === "recordPayment" && job.order_id !== null) {
      await transitionOrder(client, job.order_id, "ANCHORED", "chain:confirmed");
    }
  });
}

/**
 * Pengiriman gagal (jaringan, gas, nonce). Job diulang dengan backoff sampai MAX_JOB_ATTEMPTS.
 * Order recordPayment menjadi SETTLED_PENDING_CHAIN. Kegagalan blockchain TIDAK membatalkan pembayaran.
 */
export async function markJobFailed(jobId: number, error: string): Promise<{ willRetry: boolean }> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      kind: ChainJob["kind"];
      order_id: number | null;
      attempts: number;
    }>("SELECT kind, order_id, attempts FROM chain_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = rows[0];
    if (!job) throw notFound("Job chain");

    const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
    const backoffSeconds = Math.min(300, 5 * 2 ** Math.max(0, job.attempts - 1));
    await client.query(
      `UPDATE chain_jobs
          SET status = $2,
              last_error = left($3, 500),
              next_attempt_at = now() + make_interval(secs => $4::double precision),
              updated_at = now()
        WHERE id = $1`,
      [jobId, terminal ? "failed" : "queued", error, backoffSeconds],
    );
    await client.query(
      "INSERT INTO chain_transactions (job_id, status, attempts) VALUES ($1, 'failed', $2)",
      [jobId, job.attempts],
    );
    if (job.kind === "recordPayment" && job.order_id !== null) {
      await transitionOrder(client, job.order_id, "SETTLED_PENDING_CHAIN", "chain:failed");
    }
    return { willRetry: !terminal };
  });
}

/** Operator: job yang sudah "failed" permanen dapat diantrekan ulang. */
export async function requeueJob(jobId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE chain_jobs
        SET status = 'queued', attempts = 0, next_attempt_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'failed'`,
    [jobId],
  );
  if (!rowCount) throw notFound("Job chain yang gagal");
}
