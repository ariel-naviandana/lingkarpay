import { config } from "../config.js";
import { pool, withTx, isUniqueViolation, type Db } from "../db/pool.js";
import { AppError, conflict, forbidden, notFound } from "../lib/errors.js";
import { randomHex, sha256Hex } from "../lib/hash.js";
import { randomBytes } from "node:crypto";
import { computePenalty } from "./billing.js";
import { enqueueCreateCircle } from "./outbox.js";
import { syncPendingOrders } from "./gatewayStatus.js";
import { assertNoOpenArrears, IS_ARREARS_ORDER, listArrears } from "./arrears.js";
import { accountColumns, destinationView, toPayoutAccount, type PayoutAccountInput } from "./payoutAccount.js";
import { depositAmountFor, listDeposits, membersWithoutDeposit, refundDeposits } from "./deposits.js";

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
  start_date: Date;
  draw_seed: string | null;
  deposit_amount: number;
}

/** DATE dari pg (tengah malam waktu lokal) menjadi "YYYY-MM-DD". */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Undian urutan giliran: anggota diurutkan berdasarkan SHA-256(seed:memberRef).
 * Seed acak dibuat saat kelompok dikunci dan ditampilkan setelahnya, sehingga siapa pun
 * dapat menghitung ulang urutannya. Pembuat kelompok tidak bisa memilih urutan.
 */
export function drawTurnOrder<T extends { member_ref: string }>(seed: string, members: T[]): T[] {
  return [...members].sort((a, b) => {
    const ha = sha256Hex(`${seed}:${a.member_ref}`);
    const hb = sha256Hex(`${seed}:${b.member_ref}`);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
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
  /** Tanggal mulai yang direncanakan (WIB); kelompok baru bisa dikunci pada/sesudah tanggal ini. */
  startDate: ymd(r.start_date),
  /** Seed undian urutan giliran (null sampai kelompok dimulai). */
  drawSeed: r.draw_seed,
  /** Dana jaminan per anggota (0 = kelompok lama tanpa jaminan). */
  depositAmount: Number(r.deposit_amount ?? 0),
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
    "SELECT id FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'",
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
  /** Tanggal mulai rencana "YYYY-MM-DD" (WIB), tidak boleh sebelum hari ini. */
  startDate: string;
  /** Rekening pencairan pembuat (wajib, karena pembuat juga anggota yang mendapat giliran). */
  payoutAccount: PayoutAccountInput;
}

/** Membuat kelompok. Biaya admin ditetapkan aplikasi (DEFAULT_ADMIN_FEE), bukan oleh pembuat. */
export async function createCircle(userId: number, input: CreateCircleInput) {
  const acct = accountColumns(input.payoutAccount);
  return withTx(async (client) => {
    // Penunggak tidak boleh membuat kelompok baru sampai tunggakannya lunas.
    await assertNoOpenArrears(client, userId);
    const sd = await client.query<{ ok: boolean; too_far: boolean }>(
      `SELECT $1::date >= (now() AT TIME ZONE 'Asia/Jakarta')::date AS ok,
              $1::date > (now() AT TIME ZONE 'Asia/Jakarta')::date + 365 AS too_far`,
      [input.startDate],
    );
    if (!sd.rows[0]!.ok) throw new AppError("INVALID_START_DATE", "Tanggal mulai tidak boleh sebelum hari ini", 400);
    if (sd.rows[0]!.too_far) throw new AppError("INVALID_START_DATE", "Tanggal mulai paling lambat satu tahun dari hari ini", 400);
    const { rows } = await client.query<CircleRow>(
      `INSERT INTO circles
         (name, contribution_amount, member_count, period_days, penalty_pct, admin_fee, created_by, start_date,
          deposit_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        input.name,
        input.contributionAmount,
        input.memberCount,
        input.periodDays,
        input.penaltyPct,
        config.DEFAULT_ADMIN_FEE,
        userId,
        input.startDate,
        depositAmountFor(input.contributionAmount, input.penaltyPct),
      ],
    );
    const circle = rows[0]!;
    const m = await client.query<{ id: number }>(
      `INSERT INTO members (circle_id, user_id, member_ref, status,
                            payout_channel, payout_account_last4, payout_account_name, payout_account_hash,
                            payout_account_updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, now()) RETURNING id`,
      [circle.id, userId, "m_" + randomHex(4), acct.channel, acct.last4, acct.name, acct.hash],
    );
    return { ...toCircle(circle), myMemberId: m.rows[0]!.id };
  });
}

export async function listCircles(userId: number) {
  const { rows } = await pool.query<CircleRow & { joined: number }>(
    `SELECT c.*,
            (SELECT count(*)::int FROM members m2 WHERE m2.circle_id = c.id AND m2.status = 'active') AS joined
       FROM circles c
       JOIN members m ON m.circle_id = c.id AND m.user_id = $1 AND m.status = 'active'
      ORDER BY c.id DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...toCircle(r), joinedCount: r.joined }));
}

/** Semua kelompok di platform (admin). Memuat pembuat dengan nama saja, tanpa email. */
export async function listAllCircles() {
  const { rows } = await pool.query<CircleRow & { joined: number; creator_name: string }>(
    `SELECT c.*, u.name AS creator_name,
            (SELECT count(*)::int FROM members m WHERE m.circle_id = c.id AND m.status = 'active') AS joined
       FROM circles c
       JOIN users u ON u.id = c.created_by
      ORDER BY c.id DESC`,
  );
  return rows.map((r) => ({ ...toCircle(r), joinedCount: r.joined, creatorName: r.creator_name }));
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

  if (current) {
    // Sinkronkan order PENDING di periode aktif langsung dari Midtrans Status API
    const pendingOrders = await pool.query<{ order_id: string }>(
      `SELECT order_id FROM orders WHERE period_id = $1 AND status = 'PENDING'`,
      [current.id],
    );
    await syncPendingOrders(pendingOrders.rows.map((o) => o.order_id));
  }

  const memberRows = (
    await pool.query<{
      id: number;
      member_ref: string;
      turn_order: number | null;
      name: string;
      payment_status: string | null;
      payout_channel: string | null;
      payout_account_last4: string | null;
      payout_account_name: string | null;
      payout_account_updated_at: Date | null;
      status: "invited" | "active";
    }>(
      `SELECT m.id, m.member_ref, m.turn_order, u.name, m.status,
              m.payout_channel, m.payout_account_last4, m.payout_account_name, m.payout_account_updated_at,
              (SELECT o.status FROM orders o
                WHERE o.member_id = m.id AND o.period_id = $2
                  AND o.status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')
                LIMIT 1) AS payment_status
         FROM members m JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = $1
        ORDER BY m.turn_order NULLS LAST, (m.status = 'invited'), m.id`,
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
      /** invited = diundang tapi belum menerima; active = anggota. */
      status: m.status,
      // Rekening tersamar hanya untuk pemiliknya dan pembuat kelompok (yang memicu pencairan).
      hasPayoutAccount: toPayoutAccount(m) !== null,
      payoutAccount: m.id === myMemberId || circle.created_by === userId ? toPayoutAccount(m) : null,
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
    // Tunggakan (iuran tak dibayar saat periode ditutup kuorum) dan pelunasannya, untuk transparansi.
    arrears: await listArrears(circleId, now),
    // Dana jaminan tiap anggota (status, terpakai, pengembalian).
    deposits: await listDeposits(circleId),
  };
}

/** Tampilan publik untuk portal verifikasi (tanpa data pribadi user). Terbuka tanpa login. */
export async function getPublicCircle(circleId: number) {
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
      payment_status: string | null;
    }>(
      `SELECT m.id, m.member_ref, m.turn_order,
              (SELECT o.status FROM orders o
                WHERE o.member_id = m.id AND o.period_id = $2
                  AND o.status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')
                LIMIT 1) AS payment_status
         FROM members m
        WHERE m.circle_id = $1 AND m.status = 'active'
        ORDER BY m.turn_order NULLS LAST, m.id`,
      [circleId, current?.id ?? 0],
    )
  ).rows;

  const members = memberRows.map((m) => {
    const paid =
      m.payment_status === "SETTLED" ||
      m.payment_status === "SETTLED_PENDING_CHAIN" ||
      m.payment_status === "ANCHORED";
    return {
      memberId: m.id,
      memberRef: m.member_ref,
      name: m.member_ref,
      turnOrder: m.turn_order,
      isMe: false,
      currentPayment: current
        ? {
            status: m.payment_status,
            paid,
            penaltyDue: 0,
          }
        : null,
    };
  });

  return {
    circle: toCircle(circle),
    members,
    periods: periodRows.map(toPeriod),
    currentPeriod: current ? toPeriod(current) : null,
  };
}

/**
 * Mengundang pengguna terdaftar (lewat email). Yang diundang baru menjadi anggota setelah
 * menerima undangan dan mengisi rekening pencairannya. Undangan ikut mengisi kursi.
 */
export async function addMemberByEmail(userId: number, circleId: number, email: string) {
  try {
    return await withTx(async (client) => {
      const circle = await getCircleRow(client, circleId, true);
      if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa mengundang anggota");
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
        `INSERT INTO members (circle_id, user_id, member_ref, status, invited_at)
         VALUES ($1, $2, $3, 'invited', now()) RETURNING id, member_ref`,
        [circleId, u.rows[0].id, "m_" + randomHex(4)],
      );
      return {
        memberId: ins.rows[0]!.id,
        memberRef: ins.rows[0]!.member_ref,
        name: u.rows[0].name,
        status: "invited" as const,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("ALREADY_MEMBER", "Pengguna sudah menjadi anggota atau sudah diundang");
    }
    throw err;
  }
}

/** Undangan yang menunggu jawaban pengguna ini. */
export async function listInvitations(userId: number) {
  const { rows } = await pool.query<CircleRow & { member_id: number; invited_at: Date | null; creator_name: string; joined: number }>(
    `SELECT c.*, m.id AS member_id, m.invited_at, u.name AS creator_name,
            (SELECT count(*)::int FROM members m2 WHERE m2.circle_id = c.id AND m2.status = 'active') AS joined
       FROM members m
       JOIN circles c ON c.id = m.circle_id
       JOIN users u ON u.id = c.created_by
      WHERE m.user_id = $1 AND m.status = 'invited' AND c.status = 'draft'
      ORDER BY m.invited_at DESC NULLS LAST, m.id DESC`,
    [userId],
  );
  return rows.map((r) => ({
    circle: { ...toCircle(r), joinedCount: r.joined },
    memberId: r.member_id,
    creatorName: r.creator_name,
    invitedAt: r.invited_at,
  }));
}

/** Menerima undangan. Rekening pencairan wajib diisi saat itu juga. */
export async function acceptInvitation(userId: number, circleId: number, payoutAccount: PayoutAccountInput) {
  const acct = accountColumns(payoutAccount);
  return withTx(async (client) => {
    // Penunggak tidak boleh bergabung ke kelompok baru sampai tunggakannya lunas.
    await assertNoOpenArrears(client, userId);
    const circle = await getCircleRow(client, circleId, true);
    const { rows } = await client.query<{ id: number }>(
      "SELECT id FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'invited' FOR UPDATE",
      [circleId, userId],
    );
    if (!rows[0]) throw notFound("Undangan untuk kelompok ini");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai");
    await client.query(
      `UPDATE members
          SET status = 'active', joined_at = now(), payout_channel = $2, payout_account_last4 = $3,
              payout_account_name = $4, payout_account_hash = $5, payout_account_updated_at = now()
        WHERE id = $1`,
      [rows[0].id, acct.channel, acct.last4, acct.name, acct.hash],
    );
    return { circleId, memberId: rows[0].id, status: "active" as const };
  });
}

/** Menolak undangan: kursinya kosong lagi. */
export async function declineInvitation(userId: number, circleId: number) {
  const { rowCount } = await pool.query(
    `DELETE FROM members m USING circles c
      WHERE m.circle_id = $1 AND m.user_id = $2 AND m.status = 'invited'
        AND c.id = m.circle_id AND c.status = 'draft'`,
    [circleId, userId],
  );
  if (!rowCount) throw notFound("Undangan untuk kelompok ini");
  return { circleId, declined: true };
}

/** Pembuat membatalkan undangan yang belum dijawab. */
export async function cancelInvitation(userId: number, circleId: number, memberId: number) {
  return withTx(async (client) => {
    const circle = await getCircleRow(client, circleId, true);
    if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa membatalkan undangan");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai");
    const { rowCount } = await client.query(
      "DELETE FROM members WHERE id = $1 AND circle_id = $2 AND status = 'invited'",
      [memberId, circleId],
    );
    if (!rowCount) throw notFound("Undangan");
    return { circleId, memberId, cancelled: true };
  });
}

/**
 * Pembuat mengeluarkan anggota dari kelompok draft (mis. tidak kunjung menyetor jaminan).
 * Bila anggota sudah menyetor jaminan, kelompok harus dibatalkan agar jaminan dikembalikan.
 */
export async function removeDraftMember(userId: number, circleId: number, memberId: number) {
  return withTx(async (client) => {
    const circle = await getCircleRow(client, circleId, true);
    if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa mengeluarkan anggota");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai");
    const m = await client.query<{ user_id: number; has_deposit: boolean; has_order: boolean }>(
      `SELECT m.user_id,
              EXISTS (SELECT 1 FROM deposits d WHERE d.member_id = m.id) AS has_deposit,
              EXISTS (SELECT 1 FROM orders o WHERE o.member_id = m.id) AS has_order
         FROM members m WHERE m.id = $1 AND m.circle_id = $2 AND m.status = 'active'`,
      [memberId, circleId],
    );
    const row = m.rows[0];
    if (!row) throw notFound("Anggota");
    if (row.user_id === userId) throw conflict("CANNOT_REMOVE_SELF", "Pembuat tidak bisa mengeluarkan dirinya; batalkan kelompok saja");
    if (row.has_deposit || row.has_order) {
      throw conflict(
        "MEMBER_HAS_DEPOSIT",
        "Anggota ini sudah memulai atau menyetor jaminan. Batalkan kelompok agar jaminannya dikembalikan.",
      );
    }
    await client.query("DELETE FROM members WHERE id = $1", [memberId]);
    return { circleId, memberId, removed: true };
  });
}

/** Pembuat membatalkan kelompok draft. Undangan gugur dan jaminan yang sudah disetor dikembalikan. */
export async function cancelCircle(userId: number, circleId: number) {
  return withTx(async (client) => {
    const circle = await getCircleRow(client, circleId, true);
    if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa membatalkan kelompok");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok yang sudah dimulai tidak bisa dibatalkan");
    await client.query("DELETE FROM members WHERE circle_id = $1 AND status = 'invited'", [circleId]);
    await client.query("UPDATE circles SET status = 'cancelled' WHERE id = $1", [circleId]);
    const refunded = await refundDeposits(client, circleId);
    return { circleId, status: "cancelled" as const, depositsRefunded: refunded };
  });
}

/**
 * Memulai kelompok: mengunci urutan giliran dan parameter, lalu membuat semua periode.
 * Periode 1 langsung "running"; sisanya "scheduled" sampai periode sebelumnya selesai dicairkan.
 */
export async function startCircle(userId: number, circleId: number) {
  return withTx(async (client) => {
    const circle = await getCircleRow(client, circleId, true);
    if (circle.created_by !== userId) throw forbidden("Hanya pembuat kelompok yang bisa memulai");
    if (circle.status !== "draft") throw conflict("CIRCLE_STARTED", "Kelompok sudah dimulai");
    const due = await client.query<{ reached: boolean }>(
      "SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date >= start_date AS reached FROM circles WHERE id = $1",
      [circleId],
    );
    if (!due.rows[0]!.reached) {
      throw conflict(
        "START_DATE_NOT_REACHED",
        `Kelompok dijadwalkan mulai ${new Date(ymd(circle.start_date) + "T00:00:00+07:00").toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Jakarta",
        })}. Kelompok bisa dikunci mulai tanggal itu.`,
      );
    }

    const pending = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM members WHERE circle_id = $1 AND status = 'invited'",
      [circleId],
    );
    if (pending.rows[0]!.n > 0) {
      throw conflict(
        "INVITES_PENDING",
        `${pending.rows[0]!.n} undangan belum dijawab. Kelompok bisa dimulai setelah semua menerima.`,
      );
    }
    const memberRows = (
      await client.query<{ id: number; member_ref: string }>(
        "SELECT id, member_ref FROM members WHERE circle_id = $1 AND status = 'active' ORDER BY id",
        [circleId],
      )
    ).rows;
    const members = memberRows.map((r) => r.id);
    if (members.length !== circle.member_count) {
      throw conflict(
        "CIRCLE_NOT_FULL",
        `Anggota belum lengkap (${members.length}/${circle.member_count})`,
      );
    }
    // Jaminan dicek setelah anggota lengkap: urutan pesan mengikuti urutan langkah pembuat.
    const missing = await membersWithoutDeposit(client, circleId);
    if (missing.length > 0) {
      throw conflict(
        "DEPOSITS_PENDING",
        `Dana jaminan belum disetor oleh: ${missing.join(", ")}. Kelompok bisa dikunci setelah semua anggota menyetor jaminan.`,
      );
    }

    // Urutan giliran diundi (pembuat tidak bisa memilih, termasuk dirinya di urutan pertama).
    const drawSeed = randomBytes(32).toString("hex");
    const turns = drawTurnOrder(drawSeed, memberRows).map((m) => m.id);

    for (let i = 0; i < turns.length; i++) {
      await client.query("UPDATE members SET turn_order = $2 WHERE id = $1", [turns[i], i + 1]);
    }

    const startedAt = new Date();
    for (let no = 1; no <= turns.length; no++) {
      const due = new Date(startedAt.getTime() + no * circle.period_days * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO periods (circle_id, period_no, due_date, status, recipient_member_id, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [circleId, no, due, no === 1 ? "running" : "scheduled", turns[no - 1], no === 1 ? startedAt : null],
      );
    }
    await client.query(
      "UPDATE circles SET status = 'active', started_at = $2, draw_seed = $3 WHERE id = $1",
      [circleId, startedAt, drawSeed],
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

  // Sinkronkan order PENDING di kelompok ini dari gateway
  const pendingOrders = await pool.query<{ order_id: string }>(
    `SELECT o.order_id FROM orders o
       JOIN members m ON m.id = o.member_id
      WHERE m.circle_id = $1 AND o.status = 'PENDING'`,
    [circleId],
  );
  await syncPendingOrders(pendingOrders.rows.map((o) => o.order_id));

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
      period_no: number | null;
      member_ref: string;
      name: string;
      chain_status: string | null;
      tx_hash: string | null;
      is_arrears: boolean;
      kind: "contribution" | "deposit";
    }>(
      `SELECT o.order_id, o.status, o.amount, o.penalty_amount, o.admin_fee, o.gross_amount,
              o.payment_type, o.paid_at, o.created_at, p.period_no, m.member_ref, u.name, o.kind,
              ${IS_ARREARS_ORDER("o")} AS is_arrears,
              j.status AS chain_status,
              (SELECT t.tx_hash FROM chain_transactions t
                WHERE t.job_id = j.id AND t.status = 'confirmed'
                ORDER BY t.id DESC LIMIT 1) AS tx_hash
         FROM orders o
         JOIN members m ON m.id = o.member_id
         JOIN users u ON u.id = m.user_id
         LEFT JOIN periods p ON p.id = o.period_id
         LEFT JOIN chain_jobs j ON j.order_id = o.id AND j.kind = 'recordPayment'
        WHERE m.circle_id = $1
        ORDER BY o.created_at DESC`,
      [circleId],
    )
  ).rows;

  const payouts = (
    await pool.query<{
      id: number;
      period_id: number;
      period_no: number;
      amount: number;
      mode: string;
      status: string;
      member_ref: string;
      recipient_name: string;
      payout_ref_hash: string;
      recipient_account_hash: string | null;
      iris_reference_no: string | null;
      arrears_deducted: number;
      destination_channel: string | null;
      destination_last4: string | null;
      destination_name: string | null;
      transfer_ref: string | null;
      transferred_at: Date | null;
      created_at: Date;
      updated_at: Date;
      chain_status: string | null;
      tx_hash: string | null;
      chain_confirmed_at: Date | null;
    }>(
      `SELECT po.id, po.period_id, p.period_no, po.amount, po.mode, po.status, m.member_ref,
              u.name AS recipient_name, po.payout_ref_hash, po.recipient_account_hash,
              po.iris_reference_no, po.destination_channel, po.destination_last4, po.destination_name,
              po.transfer_ref, po.transferred_at, po.arrears_deducted, po.created_at, po.updated_at,
              j.status AS chain_status,
              (SELECT t.tx_hash FROM chain_transactions t
                WHERE t.job_id = j.id AND t.status = 'confirmed'
                ORDER BY t.id DESC LIMIT 1) AS tx_hash,
              (SELECT t.confirmed_at FROM chain_transactions t
                WHERE t.job_id = j.id AND t.status = 'confirmed'
                ORDER BY t.id DESC LIMIT 1) AS chain_confirmed_at
         FROM payouts po
         JOIN periods p ON p.id = po.period_id
         JOIN members m ON m.id = po.recipient_member_id
         JOIN users u ON u.id = m.user_id
         LEFT JOIN chain_jobs j ON j.payout_id = po.id AND j.kind = 'markPayout'
        WHERE p.circle_id = $1
        ORDER BY p.period_no`,
      [circleId],
    )
  ).rows;

  // Rincian dana tiap pencairan: iuran yang masuk per periode, dan cara periode ditutup.
  const paidOrders = (
    await pool.query<{
      period_id: number;
      member_ref: string;
      name: string;
      amount: number;
      penalty_amount: number;
      admin_fee: number;
      paid_at: Date | null;
    }>(
      `SELECT o.period_id, m.member_ref, u.name, o.amount, o.penalty_amount, o.admin_fee, o.paid_at
         FROM orders o
         JOIN periods p ON p.id = o.period_id
         JOIN members m ON m.id = o.member_id
         JOIN users u ON u.id = m.user_id
        WHERE p.circle_id = $1 AND o.status IN ('SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED')
          AND NOT ${IS_ARREARS_ORDER("o")}
        ORDER BY o.paid_at NULLS LAST, o.id`,
      [circleId],
    )
  ).rows;

  const executed = (
    await pool.query<{ period_id: number; updated_at: Date; approve_votes: number }>(
      `SELECT pr.period_id, pr.updated_at,
              (SELECT count(*)::int FROM proposal_votes v WHERE v.proposal_id = pr.id AND v.approve) AS approve_votes
         FROM proposals pr
        WHERE pr.circle_id = $1 AND pr.status = 'executed'`,
      [circleId],
    )
  ).rows;

  const memberTotal = (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM members WHERE circle_id = $1 AND status = 'active'",
      [circleId],
    )
  ).rows[0]!.n;
  const quorumNeeded = Math.floor(memberTotal / 2) + 1;
  const arrears = await listArrears(circleId);

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
      // Pelunasan tunggakan periode lalu: diteruskan ke penerima periode itu, tidak dicatat ke contract.
      isArrearsPayment: o.is_arrears,
      // Setoran dana jaminan (periodNo null), tidak dicatat ke contract.
      isDeposit: o.kind === "deposit",
    })),
    payouts: payouts.map((p) => {
      const paid = paidOrders.filter((o) => o.period_id === p.period_id);
      const closing = executed.find((e) => e.period_id === p.period_id);
      const sum = (f: (o: (typeof paid)[number]) => number) => paid.reduce((a, o) => a + Number(f(o)), 0);
      const lastPaid = paid.reduce<Date | null>(
        (a, o) => (o.paid_at && (!a || o.paid_at > a) ? o.paid_at : a),
        null,
      );
      return {
        id: p.id,
        periodNo: p.period_no,
        amount: p.amount,
        mode: p.mode,
        status: p.status,
        recipientMemberRef: p.member_ref,
        recipientName: p.recipient_name,
        payoutRefHash: p.payout_ref_hash,
        recipientAccountHash: p.recipient_account_hash, // hash rekening; nomor asli tidak disimpan
        irisReferenceNo: p.iris_reference_no,
        // Tujuan transfer (rekening tersamar, disalin saat pencairan) dan nomor referensinya.
        destination:
          p.destination_channel && p.destination_last4 && p.destination_name
            ? destinationView(p.destination_channel, p.destination_last4, p.destination_name)
            : null,
        transferRef: p.transfer_ref,
        transferredAt: p.transferred_at,
        // Tunggakan penerima yang dipotong dari jatahnya (iuran + penalti), diteruskan ke kreditornya.
        arrearsDeducted: Number(p.arrears_deducted),
        deductedArrears: arrears
          .filter((a) => a.status === "deducted" && a.settledPayoutPeriodNo === p.period_no)
          .map((a) => ({
            periodNo: a.periodNo,
            creditorName: a.creditorName,
            amount: a.amount,
            penaltyAmount: a.penaltyAmount,
            forward: a.forward,
          })),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        chainStatus: p.chain_status,
        txHash: p.tx_hash,
        chainConfirmedAt: p.chain_confirmed_at,
        // Dari mana dana pencairan berasal. Biaya admin adalah pendapatan platform, tidak ikut dicairkan.
        contributionTotal: sum((o) => o.amount),
        penaltyTotal: sum((o) => o.penalty_amount),
        adminFeeTotal: sum((o) => o.admin_fee),
        paidCount: paid.length,
        memberCount: memberTotal,
        contributors: paid.map((o) => ({
          memberRef: o.member_ref,
          name: o.name,
          amount: o.amount,
          penaltyAmount: o.penalty_amount,
          paidAt: o.paid_at,
        })),
        lastPaidAt: lastPaid,
        closedBy: closing ? ("quorum" as const) : ("all_paid" as const),
        closedAt: closing?.updated_at ?? lastPaid,
        approveVotes: closing?.approve_votes ?? null,
        quorumNeeded: closing ? quorumNeeded : null,
      };
    }),
  };
}
