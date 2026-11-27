import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { boot, notification, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";

/**
 * Tunggakan: anggota yang tidak membayar saat periode ditutup kuorum menunggak kepada penerimanya;
 * dilunasi lewat bayar susulan atau dipotong dari jatahnya; dananya diteruskan ke kreditor.
 * Postgres sungguhan, Midtrans tiruan. Dilewati otomatis bila Postgres tidak berjalan.
 */
let ready = false;
let ctx!: Awaited<ReturnType<typeof boot>>;
let arrears!: typeof import("../services/arrears.js");
let snapCalls = 0;

before(async () => {
  ready = await prepareTestDatabase();
  if (!ready) return;
  ctx = await boot();
  arrears = await import("../services/arrears.js");
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

const asUser = (m: Seeded["members"][number]) => ({ id: m.userId, name: m.name, email: m.email, role: "user" as const });
const code = (e: unknown) => (e as { code?: string }).code;

/** Iuran lunas langsung di database (tanpa Midtrans) untuk anggota ke-i pada periode itu. */
async function paid(s: Seeded, periodId: number, i: number) {
  await ctx.pool.query(
    `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                         idempotency_key, expires_at, paid_at)
     VALUES ($1, $2, $3, 10000, 1000, 11000, 'ANCHORED', $1, now() + interval '1 hour', now())`,
    [`LP-ar-${periodId}-${i}`, s.members[i]!.memberId, periodId],
  );
}

/**
 * Kelompok 3 anggota, periode 1 sudah lewat tenggat (penalti 5%). Hanya anggota 1 (penerima) membayar,
 * lalu kuorum (anggota 1 dan 2) menutup periode 1: anggota 2 dan 3 menunggak kepada anggota 1.
 */
async function closedByQuorum() {
  const s = await seedCircle(ctx.pool, { memberCount: 3, dueInDays: -1 });
  await paid(s, s.periodId, 0);
  const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
  await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
  await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
  return s;
}

const arrearRows = (circleId: number) =>
  ctx.pool
    .query<{ id: number; debtor_member_id: number; creditor_member_id: number; amount: number; status: string; forward_ref: string | null; forward_amount: number | null; forward_last4: string | null }>(
      "SELECT id, debtor_member_id, creditor_member_id, amount, status, forward_ref, forward_amount, forward_last4 FROM arrears WHERE circle_id = $1 ORDER BY id",
      [circleId],
    )
    .then((r) => r.rows);

describe("tunggakan", () => {
  dbTest("kuorum menutup periode: yang belum bayar menunggak kepada penerima; penerima tidak menunggak ke diri sendiri", async () => {
    const s = await closedByQuorum();
    const rows = await arrearRows(s.circleId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.debtor_member_id, r.creditor_member_id, Number(r.amount), r.status]),
      [
        [s.members[1]!.memberId, s.members[0]!.memberId, 10000, "open"],
        [s.members[2]!.memberId, s.members[0]!.memberId, 10000, "open"],
      ],
    );
    // Penerima periode 1 hanya menerima yang terkumpul.
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.amount, 10000);
    assert.equal(po.arrearsDeducted, 0);
  });

  dbTest("periode lunas semua tidak membuat tunggakan", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 2 });
    await paid(s, s.periodId, 0);
    await paid(s, s.periodId, 1);
    assert.equal((await arrearRows(s.circleId)).length, 0);
  });

  dbTest("bayar susulan: tagihan iuran + penalti + admin; lunas diteruskan ke kreditor, tidak dicatat ke chain", async () => {
    const s = await closedByQuorum();
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    const [, a3] = await arrearRows(s.circleId);

    // Hanya penunggaknya sendiri.
    await assert.rejects(() => ctx.checkout.createArrearsCheckout(asUser(s.members[1]!), a3!.id), (e) => code(e) === "FORBIDDEN");
    const co = await ctx.checkout.createArrearsCheckout(asUser(s.members[2]!), a3!.id);
    assert.equal(co.amount, 10000);
    assert.equal(co.penaltyAmount, 500);
    assert.equal(co.grossAmount, 11500);

    const jobsBefore = await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chain_jobs WHERE kind = 'recordPayment'");
    for (const st of ["pending", "settlement"] as const) {
      const res = await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: notification(co, st) });
      assert.equal(res.statusCode, 200);
    }
    const after = (await arrearRows(s.circleId))[1]!;
    assert.equal(after.status, "paid");
    assert.equal(Number(after.forward_amount), 10500); // iuran + penalti; biaya admin tetap pendapatan platform
    assert.equal(after.forward_last4, "0001"); // rekening kreditor (anggota 1, seed BCA ...0001)
    assert.match(after.forward_ref ?? "", /^SIM-TRF-\d{8}-A\d+$/);
    const jobsAfter = await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chain_jobs WHERE kind = 'recordPayment'");
    assert.equal(jobsAfter.rows[0]!.n, jobsBefore.rows[0]!.n);

    // Tidak bisa dilunasi dua kali.
    await assert.rejects(() => ctx.checkout.createArrearsCheckout(asUser(s.members[2]!), a3!.id), (e) => code(e) === "ARREAR_SETTLED");

    // Rekonsiliasi: pelunasan ditandai informasi (bukan "lunas tanpa job chain") dan sudah diteruskan.
    // (Order seed lain sengaja tanpa transaksi chain, jadi yang diperiksa hanya order pelunasan.)
    const rec = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    const line = rec.orders.find((o) => o.orderId === co.orderId)!;
    assert.deepEqual(line.flags, ["ARREARS_PAYMENT"]);
    assert.equal(rec.arrears.paid, 1);
    assert.equal(rec.arrears.open, 1);
    assert.equal(rec.arrears.notForwarded, 0);
    assert.equal(rec.periods.find((p) => p.periodNo === 1)!.difference, 0);
  });

  dbTest("giliran penunggak: tunggakan (+penalti) dipotong dari jatahnya dan diteruskan ke kreditor", async () => {
    const s = await closedByQuorum();
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });

    // Periode 2 (penerima anggota 2, si penunggak): semua membayar.
    for (const i of [0, 1, 2]) await paid(s, s.period2Id, i);
    await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.period2Id]);
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.period2Id, mode: "simulated" });
    assert.equal(po.arrearsDeducted, 10500);
    assert.equal(po.amount, 30000 - 10500);

    const [a2, a3] = await arrearRows(s.circleId);
    assert.equal(a2!.status, "deducted");
    assert.equal(Number(a2!.forward_amount), 10500);
    assert.equal(a2!.forward_last4, "0001");
    assert.equal(a3!.status, "open"); // tunggakan anggota lain tidak tersentuh

    const view = await arrears.listArrears(s.circleId);
    assert.equal(view[0]!.settledPayoutPeriodNo, 2);
    const hist = await ctx.circles.circlePayments(s.owner.id, s.circleId);
    const p2 = hist.payouts.find((p) => p.periodNo === 2)!;
    assert.equal(p2.arrearsDeducted, 10500);
    assert.equal(p2.deductedArrears.length, 1);
    assert.equal(p2.deductedArrears[0]!.creditorName, "User 1");

    const rec = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.equal(rec.arrears.deducted, 1);
    assert.equal(rec.arrears.notForwarded, 0);
    // Terkumpul periode 2 = dicairkan + potongan tunggakan yang diteruskan.
    assert.equal(rec.periods.find((p) => p.periodNo === 2)!.difference, 0);
  });

  dbTest("pembayaran lama yang baru lunas setelah periode ditutup kuorum dianggap pelunasan tunggakan", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3 });
    await paid(s, s.periodId, 0);
    // Anggota 3 sudah checkout (PENDING) tapi belum membayar saat kuorum menutup periode.
    const co = await ctx.checkout.createCheckout(asUser(s.members[2]!), {
      circleId: s.circleId,
      periodId: s.periodId,
      memberId: s.members[2]!.memberId,
    });
    await ctx.pool.query("UPDATE periods SET due_date = now() - interval '1 minute' WHERE id = $1", [s.periodId]);
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
    await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: notification(co, "settlement") });

    const rows = await arrearRows(s.circleId);
    assert.equal(rows.find((r) => r.debtor_member_id === s.members[2]!.memberId)!.status, "paid");
    // Penerima periode 1 tetap dicairkan dari iuran periode itu saja; pelunasan diteruskan terpisah.
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.amount, 10000);
  });
});
