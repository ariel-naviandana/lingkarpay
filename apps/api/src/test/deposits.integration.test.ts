import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { boot, markDepositsPaid, notification, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";

/**
 * Dana jaminan: disetor lewat gateway sebelum kelompok dikunci, menutup tunggakan yang tidak bisa lagi
 * dipotong dari jatah (giliran penunggak sudah lewat, atau kelompok selesai), dan sisanya dikembalikan.
 * Postgres sungguhan, Midtrans tiruan. Dilewati otomatis bila Postgres tidak berjalan.
 */
let ready = false;
let ctx!: Awaited<ReturnType<typeof boot>>;
let snapCalls = 0;

before(async () => {
  ready = await prepareTestDatabase();
  if (ready) ctx = await boot();
});
after(async () => {
  if (ready) await ctx.app.close();
});
beforeEach(async () => {
  if (!ready) return;
  await resetDb(ctx.pool);
  snapCalls = 0;
  ctx.midtrans.gatewayHttp.request = async () => {
    snapCalls++;
    return { status: 201, ok: true, json: { token: `tok-${snapCalls}`, redirect_url: "https://example.test/pay" } };
  };
});

function dbTest(name: string, fn: () => Promise<void>) {
  it(name, async (t) => {
    if (!ready) {
      t.skip("Postgres tidak tersedia (jalankan: docker compose up -d)");
      return;
    }
    await fn();
  });
}

interface U {
  id: number;
  email: string;
  token: string;
}
async function user(n: string): Promise<U> {
  const email = `${n}@example.com`;
  const r = await ctx.pool.query<{ id: number }>(
    "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id",
    [n, email],
  );
  const token = randomBytes(32).toString("hex");
  await ctx.pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), r.rows[0]!.id],
  );
  return { id: r.rows[0]!.id, email, token };
}
const call = (u: U, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${u.token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const asUser = (m: Seeded["members"][number]) => ({ id: m.userId, name: m.name, email: m.email, role: "user" as const });
const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const acct = (name: string) => ({ channel: "BCA", accountNumber: "1234567890", accountName: name });

async function draft(n = 2) {
  const owner = await user("pembuat");
  const created = await call(owner, "POST", "/circles", {
    name: "Arisan Jaminan",
    contributionAmount: 10000,
    memberCount: n,
    periodDays: 7,
    penaltyPct: 5,
    startDate: todayWib(),
    payoutAccount: acct("Pembuat"),
  });
  const cid = created.json<{ id: number; depositAmount: number }>().id;
  const others: U[] = [];
  for (let i = 1; i < n; i++) {
    const u = await user(`anggota${i}`);
    await call(owner, "POST", `/circles/${cid}/members`, { email: u.email });
    await call(u, "POST", `/circles/${cid}/invitation/accept`, { payoutAccount: acct(`Anggota ${i}`) });
    others.push(u);
  }
  return { owner, cid, others, depositAmount: created.json<{ depositAmount: number }>().depositAmount };
}

async function paidAll(s: Seeded, periodId: number, skip: number[] = []) {
  for (const [i, m] of s.members.entries()) {
    if (skip.includes(i)) continue;
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ($1, $2, $3, 10000, 1000, 11000, 'ANCHORED', $1, now() + interval '1 hour', now())`,
      [`LP-dep-${periodId}-${i}`, m.memberId, periodId],
    );
  }
}

/** Kelompok aktif 3 anggota dengan jaminan 10.500 per anggota (seed langsung di database). */
async function activeWithDeposits() {
  const s = await seedCircle(ctx.pool, { memberCount: 3 });
  await ctx.pool.query("UPDATE circles SET deposit_amount = 10500 WHERE id = $1", [s.circleId]);
  await markDepositsPaid(ctx.pool, s.circleId);
  const p3 = await ctx.pool.query<{ id: number }>(
    `INSERT INTO periods (circle_id, period_no, due_date, status, recipient_member_id)
     VALUES ($1, 3, now() + interval '21 days', 'scheduled', $2) RETURNING id`,
    [s.circleId, s.members[2]!.memberId],
  );
  return { ...s, period3Id: p3.rows[0]!.id };
}

const deposit = (memberId: number) =>
  ctx.pool
    .query<{ status: string; amount: number; used_amount: number; refund_amount: number | null; refund_ref: string | null }>(
      "SELECT status, amount, used_amount, refund_amount, refund_ref FROM deposits WHERE member_id = $1",
      [memberId],
    )
    .then((r) => r.rows[0]);

describe("dana jaminan", () => {
  dbTest("jaminan = iuran + penalti, disetor lewat gateway tanpa biaya admin; kelompok dikunci setelah semua menyetor", async () => {
    const { owner, cid, others, depositAmount } = await draft(2);
    assert.equal(depositAmount, 10500);

    const blocked = await call(owner, "POST", `/circles/${cid}/start`, {});
    assert.equal(errCode(blocked), "DEPOSITS_PENDING");

    const co = await call(owner, "POST", `/circles/${cid}/deposit/checkout`);
    assert.equal(co.statusCode, 201);
    const order = co.json<{ orderId: string; grossAmount: number; adminFee: number; penaltyAmount: number }>();
    assert.deepEqual([order.grossAmount, order.adminFee, order.penaltyAmount], [10500, 0, 0]);
    // Idempoten: checkout ulang memakai order yang sama.
    assert.equal((await call(owner, "POST", `/circles/${cid}/deposit/checkout`)).json<{ orderId: string }>().orderId, order.orderId);

    const wh = await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: notification(order, "settlement") });
    assert.equal(wh.statusCode, 200);
    const d = await ctx.pool.query<{ status: string; amount: number }>(
      "SELECT d.status, d.amount FROM deposits d JOIN members m ON m.id = d.member_id WHERE m.user_id = $1",
      [owner.id],
    );
    assert.deepEqual(d.rows.map((r) => [r.status, Number(r.amount)]), [["held", 10500]]);
    // Setoran jaminan tidak masuk antrean chain.
    const jobs = await ctx.pool.query("SELECT 1 FROM chain_jobs WHERE kind = 'recordPayment'");
    assert.equal(jobs.rowCount, 0);
    assert.equal(errCode(await call(owner, "POST", `/circles/${cid}/deposit/checkout`)), "ALREADY_PAID");

    const still = await call(owner, "POST", `/circles/${cid}/start`, {});
    assert.equal(errCode(still), "DEPOSITS_PENDING");
    assert.match(still.json<{ error: { message: string } }>().error.message, /anggota1/);

    await markDepositsPaid(ctx.pool, cid);
    assert.equal((await call(owner, "POST", `/circles/${cid}/start`, {})).statusCode, 200);
    // Setelah dikunci, jaminan tidak bisa disetor lagi.
    assert.equal(errCode(await call(others[0]!, "POST", `/circles/${cid}/deposit/checkout`)), "CIRCLE_STARTED");

    // Riwayat dan detail memuat setoran jaminan.
    const pays = (await call(owner, "GET", `/circles/${cid}/payments`)).json<{ payments: { isDeposit: boolean; periodNo: number | null }[] }>();
    assert.ok(pays.payments.some((p) => p.isDeposit && p.periodNo === null));
    const detail = (await call(owner, "GET", `/circles/${cid}`)).json<{ deposits: { status: string }[] }>();
    assert.equal(detail.deposits.length, 2);
  });

  dbTest("penerima yang berhenti bayar setelah giliran: tunggakannya langsung ditutup dari jaminannya", async () => {
    const s = await activeWithDeposits();
    // Periode 1: semua bayar, anggota 1 menerima.
    await paidAll(s, s.periodId);
    await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.periodId]);
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });

    // Periode 2: anggota 1 (sudah menerima) berhenti bayar; kuorum menutup setelah jatuh tempo.
    await ctx.pool.query("UPDATE periods SET due_date = now() - interval '1 hour' WHERE id = $1", [s.period2Id]);
    await paidAll(s, s.period2Id, [0]);
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[1]!), s.period2Id);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[2]!), pr.id, true);

    const a = await ctx.pool.query<{ status: string; forward_amount: number; forward_ref: string | null; creditor_member_id: number }>(
      "SELECT status, forward_amount, forward_ref, creditor_member_id FROM arrears WHERE debtor_member_id = $1",
      [s.members[0]!.memberId],
    );
    assert.equal(a.rows[0]!.status, "covered");
    assert.equal(Number(a.rows[0]!.forward_amount), 10500); // iuran + penalti 5%
    assert.equal(a.rows[0]!.creditor_member_id, s.members[1]!.memberId);
    assert.match(a.rows[0]!.forward_ref ?? "", /^SIM-TRF-\d{8}-A\d+$/);
    assert.equal(Number((await deposit(s.members[0]!.memberId))!.used_amount), 10500);
  });

  dbTest("tunggakan yang masih bisa dipotong dari jatah tidak memakai jaminan; kelompok selesai: sisa jaminan dikembalikan", async () => {
    const s = await activeWithDeposits();
    // Periode 1 ditutup kuorum: anggota 3 (giliran terakhir) menunggak.
    await ctx.pool.query("UPDATE periods SET due_date = now() - interval '1 hour' WHERE id = $1", [s.periodId]);
    await paidAll(s, s.periodId, [2]);
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
    const st = () =>
      ctx.pool
        .query<{ status: string }>("SELECT status FROM arrears WHERE debtor_member_id = $1", [s.members[2]!.memberId])
        .then((r) => r.rows[0]!.status);
    assert.equal(await st(), "open"); // gilirannya belum lewat: tidak memakai jaminan

    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(await st(), "open");
    await paidAll(s, s.period2Id);
    await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.period2Id]);
    await ctx.payouts.createPayout(s.owner, { periodId: s.period2Id, mode: "simulated" });

    // Periode 3 (terakhir): jatah anggota 3 dipotong tunggakannya; jaminan utuh lalu dikembalikan.
    await paidAll(s, s.period3Id);
    await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.period3Id]);
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.period3Id, mode: "simulated" });
    assert.equal(po.arrearsDeducted, 10500);
    assert.equal(await st(), "deducted");

    const c = await ctx.pool.query<{ status: string }>("SELECT status FROM circles WHERE id = $1", [s.circleId]);
    assert.equal(c.rows[0]!.status, "completed");
    for (const m of s.members) {
      const d = (await deposit(m.memberId))!;
      assert.equal(d.status, "refunded");
      assert.equal(Number(d.refund_amount), 10500);
      assert.match(d.refund_ref ?? "", /^SIM-TRF-\d{8}-J\d+-\d+$/);
    }
    const rec = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.equal(rec.deposits.issues, 0);
    assert.equal(rec.deposits.refundedTotal, 31500);
  });

  dbTest("kelompok selesai dengan tunggakan terbuka: ditutup dari jaminan, sisanya dikembalikan", async () => {
    const s = await activeWithDeposits();
    // Periode 1 dan 2 lunas dan cair. Periode 3 (terakhir) ditutup kuorum: anggota 1 tidak bayar.
    for (const pid of [s.periodId, s.period2Id]) {
      await paidAll(s, pid);
      await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [pid]);
      await ctx.payouts.createPayout(s.owner, { periodId: pid, mode: "simulated" });
    }
    await ctx.pool.query("UPDATE periods SET due_date = now() - interval '1 hour' WHERE id = $1", [s.period3Id]);
    await paidAll(s, s.period3Id, [0]);
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[2]!), s.period3Id);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[2]!), pr.id, true);
    // Anggota 1 sudah menerima giliran: langsung ditutup dari jaminan, sebelum pencairan terakhir.
    const a = await ctx.pool.query<{ status: string }>("SELECT status FROM arrears WHERE debtor_member_id = $1", [
      s.members[0]!.memberId,
    ]);
    assert.equal(a.rows[0]!.status, "covered");
    await ctx.payouts.createPayout(s.owner, { periodId: s.period3Id, mode: "simulated" });
    const d1 = (await deposit(s.members[0]!.memberId))!;
    assert.deepEqual([d1.status, Number(d1.used_amount), Number(d1.refund_amount)], ["refunded", 10500, 0]);
    const d2 = (await deposit(s.members[1]!.memberId))!;
    assert.equal(Number(d2.refund_amount), 10500);
  });

  dbTest("pembuat membatalkan kelompok draft: undangan gugur, jaminan dikembalikan; anggota tanpa jaminan bisa dikeluarkan", async () => {
    const { owner, cid, others } = await draft(3);
    const ids = (
      await ctx.pool.query<{ id: number; user_id: number }>("SELECT id, user_id FROM members WHERE circle_id = $1", [cid])
    ).rows;
    const m1 = ids.find((r) => r.user_id === others[0]!.id)!.id;
    const m2b = ids.find((r) => r.user_id === others[1]!.id)!.id;
    // Pembuat dan anggota 1 sudah menyetor jaminan; anggota 2 belum.
    await markDepositsPaid(ctx.pool, cid);
    await ctx.pool.query("DELETE FROM deposits WHERE member_id = $1", [m2b]);
    await ctx.pool.query("DELETE FROM orders WHERE member_id = $1", [m2b]);

    assert.equal(errCode(await call(owner, "DELETE", `/circles/${cid}/members/${m1}`)), "MEMBER_HAS_DEPOSIT");
    assert.equal((await call(others[0]!, "DELETE", `/circles/${cid}/members/${m2b}`)).statusCode, 403);
    assert.equal((await call(owner, "DELETE", `/circles/${cid}/members/${m2b}`)).statusCode, 200);

    assert.equal((await call(others[0]!, "POST", `/circles/${cid}/cancel`)).statusCode, 403);
    const cancelled = await call(owner, "POST", `/circles/${cid}/cancel`);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json<{ depositsRefunded: number }>().depositsRefunded, 2);
    const d = (await deposit(m1))!;
    assert.deepEqual([d.status, Number(d.refund_amount)], ["refunded", 10500]);
    assert.equal(errCode(await call(owner, "POST", `/circles/${cid}/start`, {})), "CIRCLE_STARTED");
    assert.equal(errCode(await call(owner, "POST", `/circles/${cid}/cancel`)), "CIRCLE_STARTED");
  });
});
