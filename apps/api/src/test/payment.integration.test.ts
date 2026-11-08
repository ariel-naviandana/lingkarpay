import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSignature } from "../lib/signature.js";
import {
  TEST_SERVER_KEY,
  TEST_SIGNATURE_KEY,
  boot,
  notification,
  prepareTestDatabase,
  resetDb,
  seedCircle,
  type Seeded,
} from "./helpers.js";

/**
 * Tes integrasi alur pembayaran dengan Postgres sungguhan (database "lingkarpay_test").
 * Panggilan ke Midtrans diganti tiruan; tidak ada jaringan keluar.
 * Dilewati otomatis bila Postgres tidak berjalan (docker compose up -d).
 */
let ready = false;
let ctx!: Awaited<ReturnType<typeof boot>>;
let snapCalls = 0;

before(async () => {
  ready = await prepareTestDatabase();
  if (ready) ctx = await boot();
});

after(async () => {
  if (ready) await ctx.app.close(); // juga menutup pool database
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

const code = (e: unknown) => (e as { code?: string }).code;
const asUser = (m: Seeded["members"][number]) => ({ id: m.userId, name: m.name, email: m.email });

async function checkoutFor(s: Seeded, index: number) {
  const m = s.members[index]!;
  return ctx.checkout.createCheckout(asUser(m), {
    circleId: s.circleId,
    periodId: s.periodId,
    memberId: m.memberId,
  });
}

async function send(body: Record<string, unknown>) {
  const res = await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: body });
  return { code: res.statusCode, ...res.json<{ ok: boolean; outcome: string }>() };
}

async function settle(co: { orderId: string; grossAmount: number }) {
  await send(notification(co, "pending"));
  return send(notification(co, "settlement"));
}

async function orderStatus(orderId: string): Promise<string> {
  const r = await ctx.pool.query<{ status: string }>("SELECT status FROM orders WHERE order_id = $1", [orderId]);
  return r.rows[0]!.status;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await ctx.pool.query<{ n: number }>(sql, params);
  return r.rows[0]!.n;
}

const jobs = () => count("SELECT count(*)::int AS n FROM chain_jobs WHERE kind = 'recordPayment'");

describe("checkout", () => {
  dbTest("membuat order PENDING dengan token dan tagihan iuran + biaya admin", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    assert.equal(co.status, "PENDING");
    assert.equal(co.token, "tok-1");
    assert.equal(co.amount, 10000);
    assert.equal(co.penaltyAmount, 0);
    assert.equal(co.adminFee, 1000);
    assert.equal(co.grossAmount, 11000);
    assert.equal(co.reused, false);
    assert.match(co.orderId, /^LP-\d+-1-\d+-[a-z0-9]+$/);
    assert.ok(co.orderId.length <= 50);
  });

  dbTest("idempoten: checkout ulang memakai order dan token yang sama (Snap dipanggil sekali)", async () => {
    const s = await seedCircle(ctx.pool);
    const a = await checkoutFor(s, 0);
    const b = await checkoutFor(s, 0);
    assert.equal(b.orderId, a.orderId);
    assert.equal(b.token, a.token);
    assert.equal(b.reused, true);
    assert.equal(snapCalls, 1);
    assert.equal(await count("SELECT count(*)::int AS n FROM orders"), 1);
  });

  dbTest("dua checkout serentak menghasilkan satu order, keduanya mendapat token", async () => {
    const s = await seedCircle(ctx.pool);
    const [a, b] = await Promise.all([checkoutFor(s, 0), checkoutFor(s, 0)]);
    assert.equal(a.orderId, b.orderId);
    assert.ok(a.token && b.token);
    assert.equal(await count("SELECT count(*)::int AS n FROM orders"), 1);
    assert.equal(snapCalls, 1);
  });

  dbTest("anggota lain tidak boleh membayar iuran orang lain (FORBIDDEN)", async () => {
    const s = await seedCircle(ctx.pool);
    const intruder = asUser(s.members[1]!);
    await assert.rejects(
      () => ctx.checkout.createCheckout(intruder, { circleId: s.circleId, periodId: s.periodId, memberId: s.members[0]!.memberId }),
      (e) => code(e) === "FORBIDDEN",
    );
  });

  dbTest("iuran yang sudah lunas ditolak (ALREADY_PAID)", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await settle(co);
    await assert.rejects(() => checkoutFor(s, 0), (e) => code(e) === "ALREADY_PAID");
  });

  dbTest("periode yang belum berjalan ditolak (PERIOD_NOT_OPEN)", async () => {
    const s = await seedCircle(ctx.pool);
    const m = s.members[0]!;
    await assert.rejects(
      () => ctx.checkout.createCheckout(asUser(m), { circleId: s.circleId, periodId: s.period2Id, memberId: m.memberId }),
      (e) => code(e) === "PERIOD_NOT_OPEN",
    );
  });

  dbTest("terlambat: tagihan memuat penalti (5% dibulatkan ke atas)", async () => {
    const s = await seedCircle(ctx.pool, { dueInDays: -2, contribution: 10001, penaltyPct: 5 });
    const co = await checkoutFor(s, 0);
    assert.equal(co.penaltyAmount, 501);
    assert.equal(co.grossAmount, 10001 + 501 + 1000);
  });

  dbTest("order yang gagal membuat token ditutup (FAILED) agar bisa dicoba lagi", async () => {
    const s = await seedCircle(ctx.pool);
    ctx.midtrans.gatewayHttp.request = async () => ({ status: 400, ok: false, json: { error_messages: ["ditolak"] } });
    await assert.rejects(() => checkoutFor(s, 0), (e) => code(e) === "GATEWAY_ERROR");
    assert.equal(await count("SELECT count(*)::int AS n FROM orders WHERE status = 'FAILED'"), 1);
    // percobaan berikutnya berhasil dengan order baru
    ctx.midtrans.gatewayHttp.request = async () => ({ status: 201, ok: true, json: { token: "tok-ok" } });
    const co = await checkoutFor(s, 0);
    assert.equal(co.token, "tok-ok");
    assert.equal(await count("SELECT count(*)::int AS n FROM orders"), 2);
  });

  dbTest("order kedaluwarsa diganti order baru", async () => {
    const s = await seedCircle(ctx.pool);
    const first = await checkoutFor(s, 0);
    await ctx.pool.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE order_id = $1", [first.orderId]);
    const second = await checkoutFor(s, 0);
    assert.notEqual(second.orderId, first.orderId);
    assert.equal(await orderStatus(first.orderId), "EXPIRED");
    assert.equal(second.status, "PENDING");
  });
});

describe("webhook", () => {
  dbTest("settlement valid: order SETTLED, satu job outbox, riwayat status tercatat", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const r1 = await send(notification(co, "pending"));
    assert.deepEqual([r1.code, r1.outcome], [200, "unchanged"]);
    const r2 = await send(notification(co, "settlement"));
    assert.deepEqual([r2.code, r2.outcome], [200, "applied"]);
    assert.equal(await orderStatus(co.orderId), "SETTLED");
    assert.equal(await jobs(), 1);
    const h = await ctx.pool.query<{ to_status: string }>(
      "SELECT to_status FROM order_status_history ORDER BY id",
    );
    assert.deepEqual(h.rows.map((r) => r.to_status), ["SETTLED"]);
    const o = await ctx.pool.query<{ paid_at: Date | null; gateway_ref: string | null; payment_type: string | null }>(
      "SELECT paid_at, gateway_ref, payment_type FROM orders WHERE order_id = $1",
      [co.orderId],
    );
    assert.ok(o.rows[0]!.paid_at);
    assert.equal(o.rows[0]!.payment_type, "bank_transfer");
    assert.ok(o.rows[0]!.gateway_ref);
  });

  dbTest("notifikasi duplikat diabaikan: tidak ada job ganda", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const body = notification(co, "settlement");
    assert.equal((await send(body)).outcome, "applied");
    const again = await send(body);
    assert.deepEqual([again.code, again.outcome], [200, "duplicate"]);
    assert.equal(await jobs(), 1);
    assert.equal(await count("SELECT count(*)::int AS n FROM webhook_events WHERE signature_valid"), 1);
  });

  dbTest("dua notifikasi identik serentak: tepat satu yang diterapkan", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const body = notification(co, "settlement");
    const [a, b] = await Promise.all([send(body), send(body)]);
    assert.deepEqual([a.outcome, b.outcome].sort(), ["applied", "duplicate"]);
    assert.equal(await jobs(), 1);
    assert.equal(await orderStatus(co.orderId), "SETTLED");
  });

  dbTest("signature salah ditolak (401), status tidak berubah, dicatat", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const r = await send(notification(co, "settlement", { badSignature: true }));
    assert.deepEqual([r.code, r.outcome], [401, "invalid_signature"]);
    assert.equal(await orderStatus(co.orderId), "PENDING");
    assert.equal(await jobs(), 0);
    assert.equal(
      await count("SELECT count(*)::int AS n FROM webhook_events WHERE outcome = 'invalid_signature'"),
      1,
    );
  });

  dbTest("signature dihitung dari Signature Secret Key, bukan Server Key", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const r = await send(notification(co, "settlement", { signWith: TEST_SERVER_KEY }));
    assert.equal(r.code, 401);
    assert.equal(await orderStatus(co.orderId), "PENDING");
  });

  dbTest("notifikasi palsu tidak memblokir notifikasi asli yang sama isinya", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await send(notification(co, "settlement", { badSignature: true }));
    const real = await send(notification(co, "settlement"));
    assert.deepEqual([real.code, real.outcome], [200, "applied"]);
  });

  dbTest("gross_amount tidak sama dengan tagihan ditolak (400), status tidak berubah", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    const r = await send(notification(co, "settlement", { extra: { gross_amount: "1000.00" } }));
    assert.deepEqual([r.code, r.outcome], [400, "amount_mismatch"]);
    assert.equal(await orderStatus(co.orderId), "PENDING");
    assert.equal(await jobs(), 0);
  });

  dbTest("order tidak dikenal (mis. transaksi tes): 200 dan dicatat", async () => {
    await seedCircle(ctx.pool);
    const r = await send(notification({ orderId: "TEST-123", grossAmount: 10000 }, "settlement"));
    assert.deepEqual([r.code, r.outcome], [200, "unknown_order"]);
    assert.equal(await count("SELECT count(*)::int AS n FROM webhook_events WHERE outcome = 'unknown_order'"), 1);
  });

  dbTest("payload tidak lengkap ditolak (400)", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: { foo: "bar" } });
    assert.equal(res.statusCode, 400);
  });

  dbTest("notifikasi tidak berurutan: pending setelah settlement tidak menurunkan status", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await send(notification(co, "settlement"));
    const late = await send(notification(co, "pending"));
    assert.deepEqual([late.code, late.outcome], [200, "ignored_transition"]);
    assert.equal(await orderStatus(co.orderId), "SETTLED");
    assert.equal(await jobs(), 1);
  });

  dbTest("expire menutup order; settlement sesudahnya tidak menghidupkan lagi (status final)", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    assert.equal((await send(notification(co, "expire"))).outcome, "applied");
    assert.equal(await orderStatus(co.orderId), "EXPIRED");
    const late = await send(notification(co, "settlement"));
    assert.deepEqual([late.code, late.outcome], [200, "ignored_transition"]);
    assert.equal(await orderStatus(co.orderId), "EXPIRED");
    assert.equal(await jobs(), 0);
  });

  dbTest("deny menjadi FAILED; checkout berikutnya membuat order baru", async () => {
    const s = await seedCircle(ctx.pool);
    const first = await checkoutFor(s, 0);
    await send(notification(first, "deny"));
    assert.equal(await orderStatus(first.orderId), "FAILED");
    const second = await checkoutFor(s, 0);
    assert.notEqual(second.orderId, first.orderId);
    assert.equal(second.status, "PENDING");
    assert.equal(snapCalls, 2);
  });
});

describe("periode dan pencairan", () => {
  dbTest("periode siap cair hanya setelah semua anggota lunas", async () => {
    const s = await seedCircle(ctx.pool);
    const a = await checkoutFor(s, 0);
    const b = await checkoutFor(s, 1);
    await settle(a);
    const status = () =>
      ctx.pool.query<{ status: string }>("SELECT status FROM periods WHERE id = $1", [s.periodId]).then((r) => r.rows[0]!.status);
    assert.equal(await status(), "running");
    await settle(b);
    assert.equal(await status(), "ready_payout");
  });

  dbTest("pencairan ditolak sebelum periode siap cair", async () => {
    const s = await seedCircle(ctx.pool);
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "PERIOD_NOT_READY",
    );
  });

  dbTest("pencairan simulasi: dana = iuran + penalti tanpa biaya admin; periode berikutnya dibuka", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    await settle(await checkoutFor(s, 1));
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
    assert.equal(po.amount, 20000);
    assert.match(po.payoutRefHash, /^0x[0-9a-f]{64}$/);

    const periods = await ctx.pool.query<{ period_no: number; status: string }>(
      "SELECT period_no, status FROM periods WHERE circle_id = $1 ORDER BY period_no",
      [s.circleId],
    );
    assert.deepEqual(periods.rows.map((p) => p.status), ["done", "running"]);
    assert.equal(await count("SELECT count(*)::int AS n FROM chain_jobs WHERE kind = 'markPayout'"), 1);
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "PAYOUT_EXISTS",
    );
  });

  dbTest("hanya pembuat kelompok yang boleh mencairkan", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    await settle(await checkoutFor(s, 1));
    const other = asUser(s.members[1]!);
    await assert.rejects(
      () => ctx.payouts.createPayout(other, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "FORBIDDEN",
    );
  });

  dbTest("kelompok ditutup setelah periode terakhir dicairkan", async () => {
    const s = await seedCircle(ctx.pool);
    await ctx.pool.query("DELETE FROM periods WHERE id = $1", [s.period2Id]);
    await settle(await checkoutFor(s, 0));
    await settle(await checkoutFor(s, 1));
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    const c = await ctx.pool.query<{ status: string }>("SELECT status FROM circles WHERE id = $1", [s.circleId]);
    assert.equal(c.rows[0]!.status, "completed");
  });

  dbTest("mode Iris ditolak bila belum diaktifkan", async () => {
    const s = await seedCircle(ctx.pool);
    await assert.rejects(
      () =>
        ctx.payouts.createPayout(s.owner, {
          periodId: s.periodId,
          mode: "iris",
          beneficiary: { name: "Dummy", account: "1234567", bank: "bca", email: "d@example.com" },
        }),
      (e) => code(e) === "IRIS_DISABLED",
    );
  });
});

describe("outbox ke modul chain", () => {
  dbTest("enqueue idempoten: satu order, satu job", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await settle(co);
    const pk = await ctx.pool.query<{ id: number }>("SELECT id FROM orders WHERE order_id = $1", [co.orderId]);
    assert.equal(await ctx.outbox.enqueueRecordPayment(ctx.pool, pk.rows[0]!.id), null);
    assert.equal(await jobs(), 1);
  });

  dbTest("payload job minimal dan tanpa data pribadi", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    const [job] = await ctx.outbox.claimJobs(5);
    assert.equal(job!.kind, "recordPayment");
    const p = job!.payload as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(p).sort(), ["circleChainId", "circleId", "memberRef", "paidAt", "periodNo", "refHash"]);
    assert.equal(p.memberRef, "m_test1");
    assert.match(String(p.refHash), /^0x[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(p).includes("example.com"));
  });

  dbTest("claimJobs mengambil job sekali; gagal memicu retry; sukses menjadikan order ANCHORED", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await settle(co);

    const first = await ctx.outbox.claimJobs(10);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.attempts, 1);
    assert.equal((await ctx.outbox.claimJobs(10)).length, 0); // sedang "sent", belum basi

    const failed = await ctx.outbox.markJobFailed(first[0]!.id, "nonce terlalu rendah");
    assert.equal(failed.willRetry, true);
    assert.equal(await orderStatus(co.orderId), "SETTLED_PENDING_CHAIN");
    assert.equal((await ctx.outbox.claimJobs(10)).length, 0); // menunggu backoff

    await ctx.pool.query("UPDATE chain_jobs SET next_attempt_at = now()");
    const second = await ctx.outbox.claimJobs(10);
    assert.equal(second.length, 1);
    assert.equal(second[0]!.attempts, 2);

    await ctx.outbox.markJobConfirmed(second[0]!.id, "0xabc123");
    assert.equal(await orderStatus(co.orderId), "ANCHORED");
    await ctx.outbox.markJobConfirmed(second[0]!.id, "0xabc123"); // idempoten
    assert.equal(
      await count("SELECT count(*)::int AS n FROM chain_transactions WHERE status = 'confirmed'"),
    1);
  });

  dbTest("gagal terus: setelah batas percobaan job menjadi failed, lalu bisa diantrekan ulang", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    const [job] = await ctx.outbox.claimJobs(1);
    await ctx.pool.query("UPDATE chain_jobs SET attempts = $2 WHERE id = $1", [job!.id, ctx.outbox.MAX_JOB_ATTEMPTS]);
    const r = await ctx.outbox.markJobFailed(job!.id, "RPC mati");
    assert.equal(r.willRetry, false);
    const st = await ctx.pool.query<{ status: string }>("SELECT status FROM chain_jobs WHERE id = $1", [job!.id]);
    assert.equal(st.rows[0]!.status, "failed");

    await ctx.outbox.requeueJob(job!.id);
    const again = await ctx.outbox.claimJobs(1);
    assert.equal(again.length, 1);
    assert.equal(again[0]!.attempts, 1);
  });
});

describe("rekonsiliasi", () => {
  dbTest("kondisi normal tanpa masalah; menunggu chain hanya informasi", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    const rep = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.equal(rep.summary.issues, 0);
    assert.equal(rep.summary.ordersByStatus.SETTLED, 1);
    assert.equal(rep.summary.grossPaid, 11000);
    assert.equal(rep.summary.adminFeeRevenue, 1000);
    assert.deepEqual(rep.orders[0]!.flags, ["CHAIN_PENDING"]);
  });

  dbTest("mendeteksi ANCHORED tanpa tx dan job gagal permanen", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    await settle(co);
    await ctx.pool.query("UPDATE orders SET status = 'ANCHORED' WHERE order_id = $1", [co.orderId]);
    const rep = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.ok(rep.orders[0]!.flags.includes("ANCHORED_WITHOUT_TX"));
    assert.ok(rep.summary.issues >= 1);

    await ctx.pool.query("UPDATE chain_jobs SET status = 'failed'");
    const rep2 = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.ok(rep2.orders[0]!.flags.includes("CHAIN_FAILED"));
  });

  dbTest("mendeteksi lunas tanpa job on-chain", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    await ctx.pool.query("DELETE FROM chain_jobs");
    const rep = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    assert.ok(rep.orders[0]!.flags.includes("PAID_WITHOUT_CHAIN_JOB"));
  });

  dbTest("selisih terkumpul vs dicairkan = 0 setelah pencairan", async () => {
    const s = await seedCircle(ctx.pool);
    await settle(await checkoutFor(s, 0));
    await settle(await checkoutFor(s, 1));
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    const rep = await ctx.reconciliation.reconcileCircle(s.owner, s.circleId, false);
    const p1 = rep.periods.find((p) => p.periodNo === 1)!;
    assert.equal(p1.collected, 20000);
    assert.equal(p1.payoutAmount, 20000);
    assert.equal(p1.difference, 0);
  });

  dbTest("hanya pembuat kelompok yang boleh melihat laporan", async () => {
    const s = await seedCircle(ctx.pool);
    await assert.rejects(
      () => ctx.reconciliation.reconcileCircle(asUser(s.members[1]!), s.circleId, false),
      (e) => code(e) === "FORBIDDEN",
    );
  });
});

describe("kelompok on-chain (createCircle)", () => {
  async function insertUser(n: number) {
    const r = await ctx.pool.query<{ id: number }>(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id",
      [`Pengguna ${n}`, `pengguna${n}@example.com`],
    );
    return { id: r.rows[0]!.id, name: `Pengguna ${n}`, email: `pengguna${n}@example.com` };
  }

  /** Membuat dan memulai kelompok lewat service (bukan seed langsung), seperti di aplikasi. */
  async function startedCircle() {
    const u1 = await insertUser(1);
    const u2 = await insertUser(2);
    const c = await ctx.circles.createCircle(u1.id, {
      name: "Arisan Uji",
      contributionAmount: 10000,
      memberCount: 2,
      periodDays: 7,
      penaltyPct: 5,
      adminFee: 1000,
    });
    await ctx.circles.addMemberByEmail(u1.id, c.id, u2.email);
    await ctx.circles.startCircle(u1.id, c.id);
    const period = await ctx.pool.query<{ id: number }>(
      "SELECT id FROM periods WHERE circle_id = $1 AND period_no = 1",
      [c.id],
    );
    const members = await ctx.pool.query<{ id: number; user_id: number }>(
      "SELECT id, user_id FROM members WHERE circle_id = $1 ORDER BY turn_order",
      [c.id],
    );
    return { u1, u2, circleId: c.id, periodId: period.rows[0]!.id, members: members.rows };
  }

  dbTest("startCircle mengantre satu job createCircle tanpa data pribadi", async () => {
    const s = await startedCircle();
    const rows = await ctx.pool.query<{ payload: Record<string, unknown>; status: string }>(
      "SELECT payload, status FROM chain_jobs WHERE kind = 'createCircle'",
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0]!.status, "queued");
    const p = rows.rows[0]!.payload as {
      circleId: number;
      contributionAmount: number;
      memberCount: number;
      members: Array<{ memberRef: string; turnOrder: number }>;
    };
    assert.equal(p.circleId, s.circleId);
    assert.equal(p.contributionAmount, 10000);
    assert.equal(p.memberCount, 2);
    assert.deepEqual(p.members.map((m) => m.turnOrder), [1, 2]);
    for (const m of p.members) assert.match(m.memberRef, /^m_[0-9a-f]{8}$/);
    const text = JSON.stringify(rows.rows[0]!.payload);
    assert.ok(!text.includes("@") && !text.includes("Pengguna"));
  });

  dbTest("job pembayaran ditahan sampai kelompok on-chain; createCircle didahulukan", async () => {
    const s = await startedCircle();
    const co = await ctx.checkout.createCheckout(
      { id: s.u1.id, name: s.u1.name, email: s.u1.email },
      { circleId: s.circleId, periodId: s.periodId, memberId: s.members[0]!.id },
    );
    await settle(co);

    const first = await ctx.outbox.claimJobs(10);
    assert.deepEqual(first.map((j) => j.kind), ["createCircle"]); // recordPayment belum boleh
    assert.equal(first[0]!.circleId, s.circleId);

    await ctx.outbox.markCircleCreated(first[0]!.id, "42", "0xcircle");
    await ctx.outbox.markCircleCreated(first[0]!.id, "42", "0xcircle"); // idempoten
    const c = await ctx.pool.query<{ chain_circle_id: string | null }>(
      "SELECT chain_circle_id FROM circles WHERE id = $1",
      [s.circleId],
    );
    assert.equal(c.rows[0]!.chain_circle_id, "42");
    assert.equal(
      await count("SELECT count(*)::int AS n FROM chain_transactions WHERE status = 'confirmed'"),
      1,
    );

    const next = await ctx.outbox.claimJobs(10);
    assert.deepEqual(next.map((j) => j.kind), ["recordPayment"]);
    assert.equal((next[0]!.payload as { circleChainId: string | null }).circleChainId, "42");
  });

  dbTest("job pembayaran juga ditahan bila createCircle gagal", async () => {
    const s = await startedCircle();
    const co = await ctx.checkout.createCheckout(
      { id: s.u1.id, name: s.u1.name, email: s.u1.email },
      { circleId: s.circleId, periodId: s.periodId, memberId: s.members[0]!.id },
    );
    await settle(co);
    const [create] = await ctx.outbox.claimJobs(10);
    await ctx.outbox.markJobFailed(create!.id, "RPC mati");
    await ctx.pool.query("UPDATE chain_jobs SET next_attempt_at = now()");
    const again = await ctx.outbox.claimJobs(10);
    assert.deepEqual(again.map((j) => j.kind), ["createCircle"]);
    assert.equal(await orderStatus(co.orderId), "SETTLED"); // pembayaran tetap sah
  });

  dbTest("markJobConfirmed menolak job createCircle (pakai markCircleCreated)", async () => {
    await startedCircle();
    const [job] = await ctx.outbox.claimJobs(1);
    await assert.rejects(
      () => ctx.outbox.markJobConfirmed(job!.id, "0xabc"),
      (e) => code(e) === "USE_MARK_CIRCLE_CREATED",
    );
  });

  dbTest("rekonsiliasi memuat status kelompok di chain", async () => {
    const s = await startedCircle();
    const before = await ctx.reconciliation.reconcileCircle(s.u1, s.circleId, false);
    assert.equal(before.chain.chainCircleId, null);
    assert.equal(before.chain.createCircleJob?.status, "queued");
    assert.equal(before.summary.issues, 0);

    await ctx.pool.query("UPDATE chain_jobs SET status = 'failed'");
    const failed = await ctx.reconciliation.reconcileCircle(s.u1, s.circleId, false);
    assert.equal(failed.summary.issues, 1);
  });
});

describe("pembatalan order", () => {
  /** Tiruan Midtrans: balasan cancel dan Status API (bertanda tangan Signature Secret Key uji). */
  function mockGateway(
    order: { orderId: string; grossAmount: number },
    cancelCode: string,
    gatewayStatus: string,
    statusCode = "200",
  ) {
    const gross = `${order.grossAmount}.00`;
    ctx.midtrans.gatewayHttp.request = async (url: string) => {
      if (url.endsWith("/cancel")) {
        return { status: 200, ok: true, json: { status_code: cancelCode, status_message: "tiruan" } };
      }
      if (url.endsWith("/status")) {
        const sig = computeSignature(order.orderId, statusCode, gross, TEST_SIGNATURE_KEY);
        return {
          status: 200,
          ok: true,
          json: {
            order_id: order.orderId,
            status_code: statusCode,
            gross_amount: gross,
            transaction_status: gatewayStatus,
            transaction_id: "trx-cancel-test",
            payment_type: "bank_transfer",
            fraud_status: "accept",
            signature_key: sig,
          },
        };
      }
      return { status: 201, ok: true, json: { token: "tok-x" } };
    };
  }

  dbTest("membatalkan order PENDING: status FAILED, lalu anggota bisa membayar lagi", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    mockGateway(co, "200", "cancel");
    const res = await ctx.orders.cancelOrder(asUser(s.members[0]!), co.orderId);
    assert.equal(res.status, "FAILED");
    assert.equal(await orderStatus(co.orderId), "FAILED");

    ctx.midtrans.gatewayHttp.request = async () => ({ status: 201, ok: true, json: { token: "tok-baru" } });
    const again = await checkoutFor(s, 0);
    assert.notEqual(again.orderId, co.orderId);
    assert.equal(again.status, "PENDING");
  });

  dbTest("belum ada transaksi di Midtrans (404): ditolak, order tetap PENDING", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    mockGateway(co, "404", "pending");
    await assert.rejects(
      () => ctx.orders.cancelOrder(asUser(s.members[0]!), co.orderId),
      (e) => code(e) === "NO_GATEWAY_TRANSACTION",
    );
    assert.equal(await orderStatus(co.orderId), "PENDING");
  });

  dbTest("Midtrans menolak (412) karena ternyata sudah dibayar: status diselaraskan, bukan dibatalkan", async () => {
    const s = await seedCircle(ctx.pool);
    const co = await checkoutFor(s, 0);
    mockGateway(co, "412", "settlement");
    await assert.rejects(
      () => ctx.orders.cancelOrder(asUser(s.members[0]!), co.orderId),
      (e) => code(e) === "NOT_CANCELLABLE",
    );
    assert.equal(await orderStatus(co.orderId), "SETTLED");
    assert.equal(await jobs(), 1);
  });

  dbTest("hanya pemilik order atau pembuat kelompok; order lunas tidak bisa dibatalkan", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3 });
    const co = await checkoutFor(s, 1); // order milik anggota 2
    mockGateway(co, "200", "cancel");
    await assert.rejects(
      () => ctx.orders.cancelOrder(asUser(s.members[2]!), co.orderId), // anggota 3 bukan pemilik/pembuat
      (e) => code(e) === "FORBIDDEN",
    );
    await settle(co);
    await assert.rejects(
      () => ctx.orders.cancelOrder(asUser(s.members[1]!), co.orderId),
      (e) => code(e) === "NOT_CANCELLABLE",
    );
  });
});

describe("parser body JSON", () => {
  dbTest("POST tanpa body dengan Content-Type JSON diterima parser (validasi yang menolak, bukan parser)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json<{ error: { code: string } }>().error.code, "VALIDATION_ERROR");
  });

  dbTest("JSON rusak ditolak (400)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{bukan json",
    });
    assert.equal(res.statusCode, 400);
  });

  dbTest("kunci __proto__ dibuang dari body", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/midtrans-webhook",
      headers: { "content-type": "application/json" },
      payload: '{"__proto__":{"admin":true},"order_id":"X","status_code":"200","gross_amount":"1.00"}',
    });
    // lolos parser; ditolak karena signature tidak ada
    assert.equal(res.statusCode, 401);
  });
});
