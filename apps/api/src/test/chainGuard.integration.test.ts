import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { boot, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";
import type { ChainPeriodView, ChainReader } from "../chain/reader.js";

/**
 * Gerbang pencairan dari contract, dengan Postgres sungguhan dan pembaca contract palsu.
 * Dilewati otomatis bila Postgres tidak berjalan.
 */
let ready = false;
let ctx!: Awaited<ReturnType<typeof boot>>;
let guard!: typeof import("../services/chainGuard.js");
let ids!: typeof import("../chain/ids.js");

before(async () => {
  ready = await prepareTestDatabase();
  if (!ready) return;
  ctx = await boot();
  guard = await import("../services/chainGuard.js");
  ids = await import("../chain/ids.js");
});
after(async () => {
  if (ready) await ctx.app.close();
});
beforeEach(async () => {
  if (ready) await resetDb(ctx.pool);
});
afterEach(() => {
  if (ready) guard.configurePayoutChainCheck();
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

/** Periode 1 siap cair di database: semua anggota lunas (tanpa lewat Midtrans). */
async function readyInDb(s: Seeded) {
  for (const [i, m] of s.members.entries()) {
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ($1, $2, $3, 10000, 1000, 11000, 'ANCHORED', $1, now() + interval '1 hour', now())`,
      [`LP-guard-${s.circleId}-${i}`, m.memberId, s.periodId],
    );
  }
  await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.periodId]);
}

/** Pembaca palsu: status contract yang diatur tes, penerima bawaan = anggota giliran 1. */
function fakeReader(view: Partial<ChainPeriodView>, calls: number[] = []): ChainReader {
  return {
    async readPeriod(_circle, periodNo) {
      calls.push(periodNo);
      return {
        circleStatus: 2,
        memberCount: 2,
        periodStatus: 2,
        paidCount: 2,
        recipient: ids.toMemberId("m_test1"),
        ...view,
      };
    },
  };
}

const failing: ChainReader = {
  async readPeriod() {
    throw new Error("RPC mati");
  },
};

const code = (e: unknown) => (e as { code?: string }).code;
const payoutCount = async (s: Seeded) =>
  (await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM payouts WHERE period_id = $1", [s.periodId]))
    .rows[0]!.n;

describe("gerbang pencairan dari contract", () => {
  dbTest("contract menyatakan siap cair: pencairan berjalan", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    const calls: number[] = [];
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({}, calls) });
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
    assert.deepEqual(calls, [1]);
  });

  dbTest("Running dengan semua lunas di contract juga boleh (markPayout akan menutup periode)", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({ periodStatus: 1, paidCount: 2 }) });
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
  });

  dbTest("contract belum mencatat semua pembayaran: ditolak, tidak ada payout tercatat", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({ periodStatus: 1, paidCount: 1 }) });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_NOT_READY",
    );
    assert.equal(await payoutCount(s), 0);
    const p = await ctx.pool.query<{ status: string }>("SELECT status FROM periods WHERE id = $1", [s.periodId]);
    assert.equal(p.rows[0]!.status, "ready_payout");
  });

  dbTest("contract mencatat periode sudah dicairkan: ditolak", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({ periodStatus: 3 }) });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_ALREADY_PAID_OUT",
    );
  });

  dbTest("penerima di contract berbeda: ditolak", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({
      mode: "on",
      reader: fakeReader({ recipient: ids.toMemberId("m_test2") }),
    });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_RECIPIENT_MISMATCH",
    );
    assert.equal(await payoutCount(s), 0);
  });

  dbTest("kelompok belum tercatat di contract: ditolak tanpa membaca chain", async () => {
    const s = await seedCircle(ctx.pool, { chainCircleId: null });
    await readyInDb(s);
    const calls: number[] = [];
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({}, calls) });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_NOT_READY",
    );
    assert.deepEqual(calls, []);
  });

  dbTest("contract tidak dapat dibaca: 503, pencairan ditunda", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: failing });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_UNAVAILABLE" && (e as { httpStatus: number }).httpStatus === 503,
    );
    assert.equal(await payoutCount(s), 0);
  });

  dbTest("mode on tanpa konfigurasi chain: ditolak; mode auto tanpa konfigurasi: dilewati", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: null });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "CHAIN_UNAVAILABLE",
    );
    guard.configurePayoutChainCheck({ mode: "auto", reader: null });
    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
  });

  dbTest("periode belum siap di database: ditolak lebih dulu tanpa membaca chain", async () => {
    const s = await seedCircle(ctx.pool);
    const calls: number[] = [];
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({}, calls) });
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "PERIOD_NOT_READY",
    );
    assert.deepEqual(calls, []);
  });

  dbTest("lewat HTTP: kode CHAIN_NOT_READY dengan status 409", async () => {
    const s = await seedCircle(ctx.pool);
    await readyInDb(s);
    guard.configurePayoutChainCheck({ mode: "on", reader: fakeReader({ periodStatus: 1, paidCount: 0 }) });
    const login = await ctx.pool.query<{ id: number }>("SELECT id FROM users WHERE id = $1", [s.owner.id]);
    assert.equal(login.rowCount, 1);
    const { randomBytes, createHash } = await import("node:crypto");
    const token = randomBytes(32).toString("hex");
    await ctx.pool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), s.owner.id],
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/payouts/simulate",
      headers: { authorization: `Bearer ${token}` },
      payload: { periodId: s.periodId },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json<{ error: { code: string } }>().error.code, "CHAIN_NOT_READY");
  });
});
