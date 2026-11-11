import { pool, withTx, type Db } from "../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../lib/errors.js";
import { isRejected, quorumOf } from "../lib/quorum.js";
import type { AuthUser } from "./auth.js";
import { enqueueCastVote, enqueueExecuteProposal, enqueueProposeClosePeriod } from "./outbox.js";

/**
 * Kuorum (keputusan operasional): usulan menutup periode yang iurannya belum lengkap.
 * Aturan sama dengan smart contract: mayoritas mutlak anggota, satu anggota satu suara, batas voting 3 hari.
 * Suara dan hasilnya dicatat ke chain lewat outbox (proposeClosePeriod, castVote, executeProposal).
 * Setelah disetujui, periode langsung "ready_payout" sehingga pencairan bisa dijalankan.
 */
export const VOTING_DAYS = 3;

const PAID = "('SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')";

/** Anggota kelompok (satu-satunya yang boleh membuat usulan, memberi suara, dan melihat). */
async function requireMember(db: Db, circleId: number, userId: number): Promise<{ id: number; member_ref: string }> {
  const { rows } = await db.query<{ id: number; member_ref: string }>(
    "SELECT id, member_ref FROM members WHERE circle_id = $1 AND user_id = $2",
    [circleId, userId],
  );
  if (!rows[0]) throw forbidden("Hanya anggota kelompok yang boleh mengakses usulan");
  return rows[0];
}

/** Usulan tutup periode. Hanya anggota, hanya saat periode berjalan dan iuran belum lengkap. */
export async function createClosePeriodProposal(user: AuthUser, periodId: number) {
  const proposalId = await withTx(async (client) => {
    const { rows } = await client.query<{
      period_no: number;
      period_status: string;
      circle_id: number;
      circle_status: string;
      member_count: number;
    }>(
      `SELECT p.period_no, p.status AS period_status, c.id AS circle_id, c.status AS circle_status, c.member_count
         FROM periods p JOIN circles c ON c.id = p.circle_id
        WHERE p.id = $1
        FOR UPDATE OF p`,
      [periodId],
    );
    const ctx = rows[0];
    if (!ctx) throw notFound("Periode");
    await requireMember(client, ctx.circle_id, user.id);
    if (ctx.circle_status !== "active" || ctx.period_status !== "running") {
      throw conflict("PERIOD_NOT_OPEN", "Periode tidak sedang berjalan");
    }

    const paid = await client.query<{ n: number }>(
      `SELECT count(DISTINCT member_id)::int AS n FROM orders WHERE period_id = $1 AND status IN ${PAID}`,
      [periodId],
    );
    if (paid.rows[0]!.n >= ctx.member_count) {
      throw conflict("PERIOD_COMPLETE", "Semua iuran sudah lunas; usulan tidak diperlukan");
    }

    // Usulan lama yang melewati batas waktu ditandai kedaluwarsa agar tidak menghalangi usulan baru.
    await client.query(
      "UPDATE proposals SET status = 'expired', updated_at = now() WHERE period_id = $1 AND status = 'open' AND deadline < now()",
      [periodId],
    );
    const live = await client.query("SELECT 1 FROM proposals WHERE period_id = $1 AND status = 'open'", [periodId]);
    if (live.rowCount) throw conflict("PROPOSAL_EXISTS", "Sudah ada usulan yang masih berlaku untuk periode ini");

    const ins = await client.query<{ id: number }>(
      `INSERT INTO proposals (circle_id, period_id, kind, created_by, deadline)
       VALUES ($1, $2, 'close_period', $3, now() + make_interval(days => $4))
       RETURNING id`,
      [ctx.circle_id, periodId, user.id, VOTING_DAYS],
    );
    await enqueueProposeClosePeriod(client, ins.rows[0]!.id);
    return ins.rows[0]!.id;
  });
  return getProposalView(user, proposalId);
}

/**
 * Suara satu anggota. Disetujui bila setuju >= kuorum (periode menjadi ready_payout dan job
 * executeProposal diantre); ditolak bila kuorum sudah mustahil tercapai.
 */
export async function castVote(user: AuthUser, proposalId: number, approve: boolean) {
  const outcome = await withTx(async (client) => {
    const { rows } = await client.query<{
      circle_id: number;
      period_id: number;
      status: string;
      deadline_passed: boolean;
      member_count: number;
    }>(
      `SELECT pr.circle_id, pr.period_id, pr.status, (pr.deadline < now()) AS deadline_passed, c.member_count
         FROM proposals pr JOIN circles c ON c.id = pr.circle_id
        WHERE pr.id = $1
        FOR UPDATE OF pr`,
      [proposalId],
    );
    const pr = rows[0];
    if (!pr) throw notFound("Usulan");
    const member = await requireMember(client, pr.circle_id, user.id);
    if (pr.status !== "open") throw conflict("PROPOSAL_NOT_OPEN", "Usulan sudah selesai");
    if (pr.deadline_passed) {
      await client.query("UPDATE proposals SET status = 'expired', updated_at = now() WHERE id = $1", [proposalId]);
      return { closed: true as const };
    }

    const dup = await client.query("SELECT 1 FROM proposal_votes WHERE proposal_id = $1 AND member_id = $2", [
      proposalId,
      member.id,
    ]);
    if (dup.rowCount) throw conflict("ALREADY_VOTED", "Anda sudah memberi suara pada usulan ini");

    const ins = await client.query<{ id: number }>(
      "INSERT INTO proposal_votes (proposal_id, member_id, approve) VALUES ($1, $2, $3) RETURNING id",
      [proposalId, member.id, approve],
    );
    await enqueueCastVote(client, ins.rows[0]!.id);

    const tally = await client.query<{ approvals: number; rejections: number }>(
      `SELECT count(*) FILTER (WHERE approve)::int AS approvals,
              count(*) FILTER (WHERE NOT approve)::int AS rejections
         FROM proposal_votes WHERE proposal_id = $1`,
      [proposalId],
    );
    const { approvals, rejections } = tally.rows[0]!;
    if (approvals >= quorumOf(pr.member_count)) {
      const closed = await client.query(
        "UPDATE periods SET status = 'ready_payout' WHERE id = $1 AND status = 'running'",
        [pr.period_id],
      );
      if (closed.rowCount) {
        await client.query("UPDATE proposals SET status = 'executed', updated_at = now() WHERE id = $1", [proposalId]);
        await enqueueExecuteProposal(client, proposalId);
      } else {
        // Periode sudah tidak berjalan (mis. semua iuran akhirnya lunas): keputusan tidak diperlukan.
        await client.query("UPDATE proposals SET status = 'expired', updated_at = now() WHERE id = $1", [proposalId]);
      }
    } else if (isRejected(rejections, pr.member_count)) {
      await client.query("UPDATE proposals SET status = 'rejected', updated_at = now() WHERE id = $1", [proposalId]);
    }
    return { closed: false as const };
  });
  if (outcome.closed) throw new AppError("VOTING_CLOSED", "Batas waktu voting sudah lewat", 409);
  return getProposalView(user, proposalId);
}

interface ProposalRow {
  id: number;
  circle_id: number;
  period_id: number;
  period_no: number;
  kind: string;
  status: string;
  deadline: Date;
  chain_proposal_id: string | null;
  member_count: number;
  approvals: number;
  rejections: number;
  my_vote: boolean | null;
}

// Status tampil: usulan "open" yang sudah melewati batas waktu dianggap "expired".
const SELECT_PROPOSALS = `
  SELECT pr.id, pr.circle_id, pr.period_id, p.period_no, pr.kind,
         CASE WHEN pr.status = 'open' AND pr.deadline < now() THEN 'expired' ELSE pr.status END AS status,
         pr.deadline, pr.chain_proposal_id, c.member_count,
         (SELECT count(*)::int FROM proposal_votes v WHERE v.proposal_id = pr.id AND v.approve) AS approvals,
         (SELECT count(*)::int FROM proposal_votes v WHERE v.proposal_id = pr.id AND NOT v.approve) AS rejections,
         (SELECT v.approve FROM proposal_votes v JOIN members mm ON mm.id = v.member_id
           WHERE v.proposal_id = pr.id AND mm.user_id = $2) AS my_vote
    FROM proposals pr
    JOIN periods p ON p.id = pr.period_id
    JOIN circles c ON c.id = pr.circle_id`;

const toView = (r: ProposalRow) => ({
  id: r.id,
  circleId: r.circle_id,
  periodId: r.period_id,
  periodNo: r.period_no,
  kind: r.kind,
  status: r.status,
  deadline: r.deadline,
  approvals: r.approvals,
  rejections: r.rejections,
  quorum: quorumOf(r.member_count),
  myVote: r.my_vote,
  chainProposalId: r.chain_proposal_id,
});

export async function getProposalView(user: AuthUser, proposalId: number) {
  const { rows } = await pool.query<ProposalRow>(`${SELECT_PROPOSALS} WHERE pr.id = $1`, [proposalId, user.id]);
  if (!rows[0]) throw notFound("Usulan");
  await requireMember(pool, rows[0].circle_id, user.id);
  return toView(rows[0]);
}

export async function listProposals(user: AuthUser, circleId: number) {
  await requireMember(pool, circleId, user.id);
  const { rows } = await pool.query<ProposalRow>(
    `${SELECT_PROPOSALS} WHERE pr.circle_id = $1 ORDER BY pr.id DESC`,
    [circleId, user.id],
  );
  return rows.map(toView);
}
