import { pool, withTx, type Db } from "../db/pool.js";
import { AppError, notFound } from "../lib/errors.js";
import { keccakHex } from "../lib/hash.js";
import { transitionOrder } from "./orderStatus.js";

/**
 * Outbox = antarmuka ke modul chain (jalur smart contract).
 *
 * Backend menulis satu baris chain_jobs per kejadian yang harus dicatat on-chain.
 * Modul chain memakai fungsi di bawah (claimJobs → kirim tx → markJobConfirmed /
 * markCircleCreated / markJobFailed). Payload sengaja minimal dan tanpa data pribadi.
 *
 * Urutan dijamin: job createCircle diberikan lebih dulu, dan job pembayaran/pencairan sebuah
 * kelompok baru diberikan setelah kelompok itu punya chain_circle_id (sudah on-chain).
 */
export const MAX_JOB_ATTEMPTS = 5;
const STALE_SENT_SECONDS = 300;

export type JobKind =
  | "createCircle"
  | "recordPayment"
  | "markPayout"
  | "proposeClosePeriod"
  | "castVote"
  | "executeProposal";

export interface CreateCirclePayload {
  circleId: number;
  contributionAmount: number;
  memberCount: number;
  periodDays: number;
  penaltyPct: number;
  /** Urutan giliran terkunci. Hanya ID samaran, tanpa data pribadi. */
  members: Array<{ memberRef: string; turnOrder: number }>;
}

export interface RecordPaymentPayload {
  circleId: number;
  /** Diisi saat job diambil (claimJobs) dari circles.chain_circle_id. */
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

export interface ProposeClosePeriodPayload {
  circleId: number;
  circleChainId: string | null;
  proposalId: number;
  periodNo: number;
}

export interface CastVotePayload {
  circleId: number;
  circleChainId: string | null;
  proposalId: number;
  /** Diisi saat job diambil (claimJobs) dari proposals.chain_proposal_id. */
  chainProposalId: string | null;
  memberRef: string;
  approve: boolean;
}

export interface ExecuteProposalPayload {
  circleId: number;
  circleChainId: string | null;
  proposalId: number;
  chainProposalId: string | null;
}

export interface ChainJob {
  id: number;
  kind: JobKind;
  orderId: number | null;
  payoutId: number | null;
  circleId: number | null;
  proposalId: number | null;
  voteId: number | null;
  payload:
    | CreateCirclePayload
    | RecordPaymentPayload
    | MarkPayoutPayload
    | ProposeClosePeriodPayload
    | CastVotePayload
    | ExecuteProposalPayload;
  attempts: number;
}

/** Dipanggil saat kelompok dimulai (di dalam transaksi startCircle). Satu kelompok, satu job. */
export async function enqueueCreateCircle(db: Db, circleId: number): Promise<number | null> {
  const c = await db.query<{
    contribution_amount: number;
    member_count: number;
    period_days: number;
    penalty_pct: number;
  }>(
    `SELECT contribution_amount, member_count, period_days, penalty_pct
       FROM circles WHERE id = $1`,
    [circleId],
  );
  if (!c.rows[0]) throw notFound("Kelompok");
  const m = await db.query<{ member_ref: string; turn_order: number }>(
    `SELECT member_ref, turn_order FROM members
      WHERE circle_id = $1 AND turn_order IS NOT NULL ORDER BY turn_order`,
    [circleId],
  );
  const payload: CreateCirclePayload = {
    circleId,
    contributionAmount: c.rows[0].contribution_amount,
    memberCount: c.rows[0].member_count,
    periodDays: c.rows[0].period_days,
    penaltyPct: c.rows[0].penalty_pct,
    members: m.rows.map((r) => ({ memberRef: r.member_ref, turnOrder: r.turn_order })),
  };
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, circle_id, payload)
     VALUES ('createCircle', $1, $2)
     ON CONFLICT (kind, circle_id) WHERE circle_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [circleId, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
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

/** Dipanggil saat usulan tutup periode dibuat. Satu usulan, satu job. */
export async function enqueueProposeClosePeriod(db: Db, proposalId: number): Promise<number | null> {
  const { rows } = await db.query<{ circle_id: number; period_no: number }>(
    `SELECT pr.circle_id, p.period_no
       FROM proposals pr JOIN periods p ON p.id = pr.period_id
      WHERE pr.id = $1`,
    [proposalId],
  );
  const r = rows[0];
  if (!r) throw notFound("Usulan");
  const payload: ProposeClosePeriodPayload = {
    circleId: r.circle_id,
    circleChainId: null,
    proposalId,
    periodNo: r.period_no,
  };
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, proposal_id, payload)
     VALUES ('proposeClosePeriod', $1, $2)
     ON CONFLICT (kind, proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [proposalId, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
}

/** Dipanggil saat anggota memberi suara. Satu suara, satu job. Payload hanya ID samaran. */
export async function enqueueCastVote(db: Db, voteId: number): Promise<number | null> {
  const { rows } = await db.query<{
    proposal_id: number;
    circle_id: number;
    member_ref: string;
    approve: boolean;
  }>(
    `SELECT v.proposal_id, pr.circle_id, m.member_ref, v.approve
       FROM proposal_votes v
       JOIN proposals pr ON pr.id = v.proposal_id
       JOIN members m ON m.id = v.member_id
      WHERE v.id = $1`,
    [voteId],
  );
  const r = rows[0];
  if (!r) throw notFound("Suara");
  const payload: CastVotePayload = {
    circleId: r.circle_id,
    circleChainId: null,
    proposalId: r.proposal_id,
    chainProposalId: null,
    memberRef: r.member_ref,
    approve: r.approve,
  };
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, vote_id, payload)
     VALUES ('castVote', $1, $2)
     ON CONFLICT (kind, vote_id) WHERE vote_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [voteId, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
}

/** Dipanggil saat usulan disetujui kuorum. Satu usulan, satu job. */
export async function enqueueExecuteProposal(db: Db, proposalId: number): Promise<number | null> {
  const { rows } = await db.query<{ circle_id: number }>("SELECT circle_id FROM proposals WHERE id = $1", [
    proposalId,
  ]);
  const r = rows[0];
  if (!r) throw notFound("Usulan");
  const payload: ExecuteProposalPayload = {
    circleId: r.circle_id,
    circleChainId: null,
    proposalId,
    chainProposalId: null,
  };
  const ins = await db.query<{ id: number }>(
    `INSERT INTO chain_jobs (kind, proposal_id, payload)
     VALUES ('executeProposal', $1, $2)
     ON CONFLICT (kind, proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [proposalId, JSON.stringify(payload)],
  );
  return ins.rows[0]?.id ?? null;
}

/**
 * Untuk modul chain: ambil job yang siap diproses dan tandai "sent".
 * - Aman dipanggil paralel (FOR UPDATE SKIP LOCKED).
 * - createCircle didahulukan. Job lain hanya diberikan bila kelompoknya sudah on-chain
 *   (circles.chain_circle_id terisi), dan payload.circleChainId diisi nilai terbaru.
 * - castVote/executeProposal hanya diberikan bila usulannya sudah on-chain (proposals.chain_proposal_id).
 * - Job "sent" yang macet > 5 menit (worker mati) diambil ulang.
 */
export async function claimJobs(limit = 10): Promise<ChainJob[]> {
  const { rows } = await pool.query<{
    id: number;
    kind: JobKind;
    order_id: number | null;
    payout_id: number | null;
    circle_id: number | null;
    proposal_id: number | null;
    vote_id: number | null;
    payload: ChainJob["payload"];
    attempts: number;
  }>(
    `UPDATE chain_jobs
        SET status = 'sent', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT j.id FROM chain_jobs j
         WHERE ((j.status = 'queued' AND j.next_attempt_at <= now())
             OR (j.status = 'sent'
                 AND j.updated_at < now() - make_interval(secs => $2::double precision)))
           AND (j.kind = 'createCircle'
                OR EXISTS (SELECT 1 FROM circles c
                            WHERE c.id = (j.payload->>'circleId')::int
                              AND c.chain_circle_id IS NOT NULL))
           AND (j.kind NOT IN ('castVote', 'executeProposal')
                OR EXISTS (SELECT 1 FROM proposals pr
                            WHERE pr.id = (j.payload->>'proposalId')::int
                              AND pr.chain_proposal_id IS NOT NULL))
         ORDER BY CASE j.kind WHEN 'createCircle' THEN 0 ELSE 1 END, j.id
         LIMIT $1
         FOR UPDATE OF j SKIP LOCKED)
      RETURNING id, kind, order_id, payout_id, circle_id, proposal_id, vote_id, payload, attempts`,
    [limit, STALE_SENT_SECONDS],
  );
  if (rows.length === 0) return [];

  const circleIds = [
    ...new Set(rows.map((r) => Number((r.payload as { circleId?: number }).circleId))),
  ].filter((n) => Number.isFinite(n));
  const chainIds = new Map<number, string | null>();
  if (circleIds.length > 0) {
    const cr = await pool.query<{ id: number; chain_circle_id: string | null }>(
      "SELECT id, chain_circle_id FROM circles WHERE id = ANY($1::int[])",
      [circleIds],
    );
    for (const c of cr.rows) chainIds.set(c.id, c.chain_circle_id);
  }

  const proposalIds = [
    ...new Set(
      rows
        .filter((r) => r.kind === "castVote" || r.kind === "executeProposal")
        .map((r) => Number((r.payload as { proposalId?: number }).proposalId)),
    ),
  ].filter((n) => Number.isFinite(n));
  const chainProposalIds = new Map<number, string | null>();
  if (proposalIds.length > 0) {
    const pr = await pool.query<{ id: number; chain_proposal_id: string | null }>(
      "SELECT id, chain_proposal_id FROM proposals WHERE id = ANY($1::int[])",
      [proposalIds],
    );
    for (const p of pr.rows) chainProposalIds.set(p.id, p.chain_proposal_id);
  }

  return rows.map((r) => {
    const payload = { ...(r.payload as unknown as Record<string, unknown>) };
    if (r.kind !== "createCircle") {
      payload.circleChainId = chainIds.get(Number(payload.circleId)) ?? null;
    }
    if (r.kind === "castVote" || r.kind === "executeProposal") {
      payload.chainProposalId = chainProposalIds.get(Number(payload.proposalId)) ?? null;
    }
    return {
      id: r.id,
      kind: r.kind,
      orderId: r.order_id,
      payoutId: r.payout_id,
      circleId: r.circle_id,
      proposalId: r.proposal_id,
      voteId: r.vote_id,
      payload: payload as unknown as ChainJob["payload"],
      attempts: r.attempts,
    };
  });
}

/**
 * Transaksi terkonfirmasi di chain untuk job recordPayment/markPayout.
 * Order recordPayment menjadi ANCHORED. Idempoten.
 * Untuk job createCircle pakai markCircleCreated (perlu id kelompok on-chain).
 */
export async function markJobConfirmed(jobId: number, txHash: string): Promise<void> {
  await withTx(async (client) => {
    const { rows } = await client.query<{
      id: number;
      kind: JobKind;
      order_id: number | null;
      status: string;
      attempts: number;
      payload: Record<string, unknown>;
    }>("SELECT id, kind, order_id, status, attempts, payload FROM chain_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = rows[0];
    if (!job) throw notFound("Job chain");
    if (job.kind === "createCircle") {
      throw new AppError(
        "USE_MARK_CIRCLE_CREATED",
        "Job createCircle dikonfirmasi lewat markCircleCreated (butuh id kelompok on-chain)",
        400,
      );
    }
    if (job.kind === "proposeClosePeriod") {
      throw new AppError(
        "USE_MARK_PROPOSAL_CREATED",
        "Job proposeClosePeriod dikonfirmasi lewat markProposalCreated (butuh id usulan on-chain)",
        400,
      );
    }
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
 * Kelompok sudah dibuat di chain. Menyimpan id kelompok on-chain ke circles.chain_circle_id
 * (membuka job pembayaran/pencairan kelompok itu) dan mengonfirmasi job createCircle. Idempoten.
 */
export async function markCircleCreated(
  jobId: number,
  chainCircleId: string,
  txHash: string,
): Promise<void> {
  const id = chainCircleId.trim();
  if (id.length === 0 || id.length > 100) {
    throw new AppError("INVALID_CHAIN_CIRCLE_ID", "chainCircleId tidak valid", 400);
  }
  await withTx(async (client) => {
    const { rows } = await client.query<{
      kind: JobKind;
      circle_id: number | null;
      status: string;
      attempts: number;
    }>("SELECT kind, circle_id, status, attempts FROM chain_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = rows[0];
    if (!job || job.kind !== "createCircle" || job.circle_id === null) {
      throw notFound("Job createCircle");
    }
    if (job.status === "confirmed") return;

    await client.query(
      "UPDATE chain_jobs SET status = 'confirmed', last_error = NULL, updated_at = now() WHERE id = $1",
      [jobId],
    );
    await client.query(
      `INSERT INTO chain_transactions (job_id, tx_hash, status, attempts, confirmed_at)
       VALUES ($1, $2, 'confirmed', $3, now())`,
      [jobId, txHash, job.attempts],
    );
    await client.query("UPDATE circles SET chain_circle_id = $2 WHERE id = $1", [job.circle_id, id]);
  });
}

/**
 * Usulan sudah dibuat di chain. Menyimpan id usulan on-chain ke proposals.chain_proposal_id
 * (membuka job suara dan eksekusi usulan itu) dan mengonfirmasi job proposeClosePeriod. Idempoten.
 */
export async function markProposalCreated(
  jobId: number,
  chainProposalId: string,
  txHash: string,
): Promise<void> {
  const id = chainProposalId.trim();
  if (id.length === 0 || id.length > 100) {
    throw new AppError("INVALID_CHAIN_PROPOSAL_ID", "chainProposalId tidak valid", 400);
  }
  await withTx(async (client) => {
    const { rows } = await client.query<{
      kind: JobKind;
      proposal_id: number | null;
      status: string;
      attempts: number;
    }>("SELECT kind, proposal_id, status, attempts FROM chain_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = rows[0];
    if (!job || job.kind !== "proposeClosePeriod" || job.proposal_id === null) {
      throw notFound("Job proposeClosePeriod");
    }
    if (job.status === "confirmed") return;

    await client.query(
      "UPDATE chain_jobs SET status = 'confirmed', last_error = NULL, updated_at = now() WHERE id = $1",
      [jobId],
    );
    await client.query(
      `INSERT INTO chain_transactions (job_id, tx_hash, status, attempts, confirmed_at)
       VALUES ($1, $2, 'confirmed', $3, now())`,
      [jobId, txHash, job.attempts],
    );
    await client.query("UPDATE proposals SET chain_proposal_id = $2, updated_at = now() WHERE id = $1", [
      job.proposal_id,
      id,
    ]);
  });
}

/**
 * Pengiriman gagal (jaringan, gas, nonce). Job diulang dengan backoff sampai MAX_JOB_ATTEMPTS.
 * Order recordPayment menjadi SETTLED_PENDING_CHAIN. Kegagalan blockchain TIDAK membatalkan pembayaran.
 */
export async function markJobFailed(jobId: number, error: string): Promise<{ willRetry: boolean }> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      kind: JobKind;
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
