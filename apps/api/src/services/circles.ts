import { pool, withTx, isUniqueViolation, type Db } from "../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../lib/errors.js";
import { randomHex } from "../lib/hash.js";
import { computePenalty } from "./billing.js";
import { enqueueCreateCircle } from "./outbox.js";

interface CircleRow {
  id: number;
  name: string;
  contribution_amount: number;
  member_count: number;
  period_days: number;
  penalty_pct: number;
  admin_fee: number;
  status: string;
  chain_circle_id: string | null;
  created_by: number;
  started_at: Date | null;
  created_at: Date;
}

interface PeriodRow {
  id: number;
  period_no: number;
  due_date: Date;
  status: string;
  recipient_member_id: number | null;
}

const toCircle = (r: CircleRow) => ({
  id: r.id,
  name: r.name,
  contributionAmount: r.contribution_amount,
  memberCount: r.member_count,
  periodDays: r.period_days,
  penaltyPct: r.penalty_pct,
  adminFee: r.admin_fee,
  status: r.status,
  chainCircleId: r.chain_circle_id,
  createdBy: r.created_by,
  startedAt: r.started_at,
  createdAt: r.created_at,
});

const toPeriod = (p: PeriodRow) => ({
  id: p.id,
  periodNo: p.period_no,
  dueDate: p.due_date,
  status: p.status,
  recipientMemberId: p.recipient_member_id,
});

async function getCircleRow(db: Db, circleId: number, lock = false): Promise<CircleRow> {
  const { rows } = await db.query<CircleRow>(
    `SELECT * FROM circles WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [circleId],
  );
  if (!rows[0]) throw notFound("Kelompok");
  return rows[0];
}

/** Mengembalikan id member bila user anggota kelompok, selain itu 403. */
export async function requireMember(db: Db, circleId: number, userId: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    "SELECT id FROM members WHERE circle_id = $1 AND user_id = $2",
    [circleId, userId],
  );
  if (!rows[0]) throw forbidden("Kamu bukan anggota kelompok ini");
  return rows[0].id;
}

export interface CreateCircleInput {
  name: string;
  contributionAmount: number;
  memberCount: number;
  periodDays: number;
  penaltyPct: number;
  adminFee: number;
}

export async function createCircle(userId: number, input: CreateCircleInput) {
  return withTx(async (client) => {
    const { rows } = await client.query<CircleRow>(
      `INSERT INTO circles
         (name, contribution_amount, member_count, period_days, penalty_pct, admin_fee, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        input.name,
        input.contributionAmount,
        input.memberCount,
        input.periodDays,
        input.penaltyPct,
        input.adminFee,
        userId,
      ],
    );
    const circle = rows[0]!;
    const m = await client.query<{ id: number }>(
      `INSERT INTO members (circle_id, user_id, member_ref)
       VALUES ($1, $2, $3) RETURNING id`,
      [circle.id, userId, "m_" + randomHex(4)],
    );
    return { ...toCircle(circle), myMemberId: m.rows[0]!.id };
  });
}

export async function listCircles(userId: number) {
  const { rows } = await pool.query<CircleRow & { joined: number }>(
    `SELECT c.*,
            (SELECT count(*)::int FROM members m2 WHERE m2.circle_id = c.id) AS joined
       FROM circles c
       JOIN members m ON m.circle_id = c.id AND m.user_id = $1
      ORDER BY c.id DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...toCircle(r), joinedCount: r.joined }));
}

export async function getCircleDetail(userId: number, circleId: number) {
  const myMemberId = await requireMember(pool, circleId, userId);
  const circle = await getCircleRow(pool, circleId);
  const periodRows = (
    await pool.query<PeriodRow>(
      `SELECT id, period_no, due_date, status, recipient_member_id
         FROM periods WHERE circle_id = $1 ORDER BY period_no`,
      [circleId],
    )
  ).rows;
  const current =
    periodRows.find((p) => p.status === "running" || p.status === "ready_payout") ?? null;

  const memberRows = (
    await pool.query<{
      id: number;
      member_ref: string;
      turn_order: number | null;
      name: string;
      payment_status: string | null;
    }>(
      `SELECT m.id, m.member_ref, m.turn_order, u.name,
              (SELECT o.status FROM orders o
                WHERE o.member_id = m.id AND o.period_id = $2
                  AND o.status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')
                LIMIT 1) AS payment_status
         FROM members m JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = $1
        ORDER BY m.turn_order NULLS LAST, m.id`,
      [circleId, current?.id ?? 0],
    )
  ).rows;

  const now = new Date();
  const members = memberRows.map((m) => {
    const paid =
      m.payment_status === "SETTLED" ||
      m.payment_status === "SETTLED_PENDING_CHAIN" ||
      m.payment_status === "ANCHORED";
    return {
      memberId: m.id,
      memberRef: m.member_ref,
      name: m.name,
      turnOrder: m.turn_order,
      isMe: m.id === myMemberId,
      currentPayment: current
        ? {
            status: m.payment_status, // null = belum ada order
            paid,
            penaltyDue: paid
              ? 0
              : computePenalty(circle.contribution_amount, circle.penalty_pct, current.due_date, now),
          }
        : null,
    };
  });

  return {
    circle: toCircle(circle),
    myMemberId,
    isCreator: circle.created_by === userId,
    members,
    periods: periodRows.map(toPeriod),
    currentPeriod: current ? toPeriod(current) : null,
  };
}

export async function addMemberByEmail(userId: number, circleId: number, email: string) {
  try {
    return await withTx(async (client) => {
      const circle = await getCircleRow(client, circleId, true);
      if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa menambah anggota");
      if (circle.status !== "draft") {
        throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai, anggota tidak bisa ditambah");
      }
      const count = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM members WHERE circle_id = $1",
        [circleId],
      );
      if (count.rows[0]!.n >= circle.member_count) {
        throw conflict("CIRCLE_FULL", "Jumlah anggota sudah penuh");
      }
      const u = await client.query<{ id: number; name: string }>(
        "SELECT id, name FROM users WHERE email = $1",
        [email.trim().toLowerCase()],
      );
      if (!u.rows[0]) throw notFound("Pengguna dengan email itu");
      const ins = await client.query<{ id: number; member_ref: string }>(
        `INSERT INTO members (circle_id, user_id, member_ref)
         VALUES ($1, $2, $3) RETURNING id, member_ref`,
        [circleId, u.rows[0].id, "m_" + randomHex(4)],
      );
      return {
        memberId: ins.rows[0]!.id,
        memberRef: ins.rows[0]!.member_ref,
        name: u.rows[0].name,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("ALREADY_MEMBER", "Pengguna sudah menjadi anggota");
    throw err;
  }
}

/**
 * Memulai kelompok: mengunci urutan giliran dan parameter, lalu membuat semua periode.
 * Periode 1 langsung "running"; sisanya "scheduled" sampai periode sebelumnya selesai dicairkan.
 */
export async function startCircle(userId: number, circleId: number, order?: number[]) {
  return withTx(async (client) => {
    const circle = await getCircleRow(client, circleId, true);
    if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa memulai");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai");

    const members = (
      await client.query<{ id: number }>(
        "SELECT id FROM members WHERE circle_id = $1 ORDER BY id",
        [circleId],
      )
    ).rows.map((r) => r.id);
    if (members.length !== circle.member_count) {
      throw conflict(
        "CIRCLE_NOT_FULL",
        `Anggota belum lengkap (${members.length}/${circle.member_count})`,
      );
    }

    let turns = members;
    if (order) {
      const same =
        order.length === members.length &&
        new Set(order).size === order.length &&
        order.every((id) => members.includes(id));
      if (!same) {
        throw new AppError("INVALID_ORDER", "Urutan giliran harus memuat semua anggota tepat sekali", 400);
      }
      turns = order;
    }

    for (let i = 0; i < turns.length; i++) {
      await client.query("UPDATE members SET turn_order = $2 WHERE id = $1", [turns[i], i + 1]);
    }

    const startedAt = new Date();
    for (let no = 1; no <= turns.length; no++) {
      const due = new Date(startedAt.getTime() + no * circle.period_days * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO periods (circle_id, period_no, due_date, status, recipient_member_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [circleId, no, due, no === 1 ? "running" : "scheduled", turns[no - 1]],
      );
    }
    await client.query(
      "UPDATE circles SET status = 'active', started_at = $2 WHERE id = $1",
      [circleId, startedAt],
    );
    // Catat kelompok ke chain (urutan giliran sudah terkunci). Job pembayaran menunggu job ini.
    await enqueueCreateCircle(client, circleId);
    return getCircleSummaryAfterStart(client, circleId);
  });
}

async function getCircleSummaryAfterStart(db: Db, circleId: number) {
  const circle = await getCircleRow(db, circleId);
  const periods = (
    await db.query<PeriodRow>(
      `SELECT id, period_no, due_date, status, recipient_member_id
         FROM periods WHERE circle_id = $1 ORDER BY period_no`,
      [circleId],
    )
  ).rows;
  return { circle: toCircle(circle), periods: periods.map(toPeriod) };
}

export async function listPeriods(userId: number, circleId: number) {
  await requireMember(pool, circleId, userId);
  const { rows } = await pool.query<PeriodRow>(
    `SELECT id, period_no, due_date, status, recipient_member_id
       FROM periods WHERE circle_id = $1 ORDER BY period_no`,
    [circleId],
  );
  return rows.map(toPeriod);
}

/** Riwayat pembayaran dan pencairan satu kelompok (terbuka untuk semua anggota). */
export async function circlePayments(userId: number, circleId: number) {
  await requireMember(pool, circleId, userId);
  const orders = (
    await pool.query<{
      order_id: string;
      status: string;
      amount: number;
      penalty_amount: number;
      admin_fee: number;
      gross_amount: number;
      payment_type: string | null;
      paid_at: Date | null;
      created_at: Date;
      period_no: number;
      member_ref: string;
      name: string;
      chain_status: string | null;
      tx_hash: string | null;
    }>(
      `SELECT o.order_id, o.status, o.amount, o.penalty_amount, o.admin_fee, o.gross_amount,
              o.payment_type, o.paid_at, o.created_at, p.period_no, m.member_ref, u.name,
              j.status AS chain_status,
              (SELECT t.tx_hash FROM chain_transactions t
                WHERE t.job_id = j.id AND t.status = 'confirmed'
                ORDER BY t.id DESC LIMIT 1) AS tx_hash
         FROM orders o
         JOIN periods p ON p.id = o.period_id
         JOIN members m ON m.id = o.member_id
         JOIN users u ON u.id = m.user_id
         LEFT JOIN chain_jobs j ON j.order_id = o.id AND j.kind = 'recordPayment'
        WHERE p.circle_id = $1
        ORDER BY o.created_at DESC`,
      [circleId],
    )
  ).rows;

  const payouts = (
    await pool.query<{
      id: number;
      period_no: number;
      amount: number;
      mode: string;
      status: string;
      member_ref: string;
      payout_ref_hash: string;
      created_at: Date;
    }>(
      `SELECT po.id, p.period_no, po.amount, po.mode, po.status, m.member_ref,
              po.payout_ref_hash, po.created_at
         FROM payouts po
         JOIN periods p ON p.id = po.period_id
         JOIN members m ON m.id = po.recipient_member_id
        WHERE p.circle_id = $1
        ORDER BY p.period_no`,
      [circleId],
    )
  ).rows;

  return {
    payments: orders.map((o) => ({
      orderId: o.order_id,
      periodNo: o.period_no,
      memberRef: o.member_ref,
      memberName: o.name,
      status: o.status,
      amount: o.amount,
      penaltyAmount: o.penalty_amount,
      adminFee: o.admin_fee,
      grossAmount: o.gross_amount,
      paymentType: o.payment_type,
      paidAt: o.paid_at,
      createdAt: o.created_at,
      chainStatus: o.chain_status,
      txHash: o.tx_hash,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      periodNo: p.period_no,
      amount: p.amount,
      mode: p.mode,
      status: p.status,
      recipientMemberRef: p.member_ref,
      payoutRefHash: p.payout_ref_hash,
      createdAt: p.created_at,
    })),
  };
}
