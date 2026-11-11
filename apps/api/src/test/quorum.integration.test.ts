import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { boot, notification, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";

/**
 * Tes integrasi kuorum (usulan tutup periode) dengan Postgres sungguhan (database "lingkarpay_test").
 * Panggilan ke Midtrans diganti tiruan. Dilewati otomatis bila Postgres tidak berjalan.
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

const code = (e: unknown) => (e as { code?: string }).code;
const asUser = (m: Seeded["members"][number]) => ({ id: m.userId, name: m.name, email: m.email });
const outsider = { id: 999999, name: "Orang Asing", email: "asing@example.com" };

async function checkoutFor(s: Seeded, index: number) {
  const m = s.members[index]!;
  return ctx.checkout.createCheckout(asUser(m), { circleId: s.circleId, periodId: s.periodId, memberId: m.memberId });
}

async function send(body: Record<string, unknown>) {
  const res = await ctx.app.inject({ method: "POST", url: "/midtrans-webhook", payload: body });
  return res.json<{ ok: boolean; outcome: string }>();
}

/** Anggota ke-`index` membayar (checkout lalu notifikasi settlement). */
async function pay(s: Seeded, index: number) {
  const co = await checkoutFor(s, index);
  await send(notification(co, "pending"));
  await send(notification(co, "settlement"));
}

async function periodStatus(periodId: number): Promise<string> {
  const r = await ctx.pool.query<{ status: string }>("SELECT status FROM periods WHERE id = $1", [periodId]);
  return r.rows[0]!.status;
}

async function jobCount(kind: string): Promise<number> {
  const r = await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chain_jobs WHERE kind = $1", [kind]);
  return r.rows[0]!.n;
}

/** Kelompok 3 anggota (kuorum 2). */
const seed3 = () => seedCircle(ctx.pool, { memberCount: 3 });

describe("kuorum: usulan tutup periode", () => {
  dbTest("anggota membuat usulan: open, tenggat 3 hari, satu job proposeClosePeriod tanpa data pribadi", async () => {
    const s = await seed3();
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    assert.equal(pr.status, "open");
    assert.equal(pr.kind, "close_period");
    assert.equal(pr.approvals, 0);
    assert.equal(pr.quorum, 2);
    const days = (new Date(pr.deadline).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 2.9 && days <= 3.01, `tenggat ${days} hari`);

    assert.equal(await jobCount("proposeClosePeriod"), 1);
    const j = await ctx.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM chain_jobs WHERE kind = 'proposeClosePeriod'",
    );
    assert.deepEqual(Object.keys(j.rows[0]!.payload).sort(), ["circleChainId", "circleId", "periodNo", "proposalId"]);
  });

  dbTest("usulan ditolak: bukan anggota, periode belum berjalan, periode sudah ready, atau usulan ganda", async () => {
    const s = await seed3();
    await assert.rejects(ctx.proposals.createClosePeriodProposal(outsider, s.periodId), (e) => code(e) === "FORBIDDEN");
    await assert.rejects(
      ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.period2Id),
      (e) => code(e) === "PERIOD_NOT_OPEN",
    );

    await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await assert.rejects(
      ctx.proposals.createClosePeriodProposal(asUser(s.members[1]!), s.periodId),
      (e) => code(e) === "PROPOSAL_EXISTS",
    );
  });

  dbTest("satu anggota satu suara; bukan anggota ditolak; tiap suara satu job castVote tanpa data pribadi", async () => {
    const s = await seed3();
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);

    const v1 = await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    assert.equal(v1.myVote, true);
    assert.equal(v1.approvals, 1);
    await assert.rejects(ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true), (e) => code(e) === "ALREADY_VOTED");
    await assert.rejects(ctx.proposals.castVote(outsider, pr.id, true), (e) => code(e) === "FORBIDDEN");

    const v2 = await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, false);
    assert.equal(v2.rejections, 1);
    assert.equal(v2.status, "open"); // 1 setuju, 1 tolak, 3 anggota: belum selesai

    assert.equal(await jobCount("castVote"), 2);
    const j = await ctx.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM chain_jobs WHERE kind = 'castVote' ORDER BY id",
    );
    assert.deepEqual(Object.keys(j.rows[0]!.payload).sort(), [
      "approve",
      "chainProposalId",
      "circleChainId",
      "circleId",
      "memberRef",
      "proposalId",
    ]);
    assert.ok(!JSON.stringify(j.rows[0]!.payload).includes("example.com")); // tanpa email
  });

  dbTest("kuorum tercapai: usulan dieksekusi, periode siap cair, pencairan berjalan walau belum lengkap", async () => {
    const s = await seed3();
    await pay(s, 0); // hanya anggota 1 yang sudah membayar
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);

    await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    assert.equal(await periodStatus(s.periodId), "running"); // 1 dari kuorum 2
    const done = await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);

    assert.equal(done.status, "executed");
    assert.equal(await periodStatus(s.periodId), "ready_payout");
    assert.equal(await jobCount("proposeClosePeriod"), 1);
    assert.equal(await jobCount("castVote"), 2);
    assert.equal(await jobCount("executeProposal"), 1);

    // periode sudah ditutup: iuran yang belum lunas tidak bisa dibayar lagi
    await assert.rejects(checkoutFor(s, 2), (e) => code(e) === "PERIOD_NOT_OPEN");
    // suara susulan ditolak karena usulan sudah selesai
    await assert.rejects(ctx.proposals.castVote(asUser(s.members[2]!), pr.id, false), (e) => code(e) === "PROPOSAL_NOT_OPEN");

    // pencairan memakai dana yang terkumpul (iuran tanpa biaya admin)
    const payout = await ctx.payouts.createPayout(asUser(s.members[0]!), { periodId: s.periodId, mode: "simulated" });
    assert.equal(payout.amount, 10000);
    assert.equal(await periodStatus(s.periodId), "done");
    assert.equal(await periodStatus(s.period2Id), "running");
  });

  dbTest("ditolak bila kuorum mustahil tercapai; periode tetap berjalan; usulan baru boleh dibuat", async () => {
    const s = await seed3();
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, false);
    const rejected = await ctx.proposals.castVote(asUser(s.members[2]!), pr.id, false); // 2 penolak dari 3
    assert.equal(rejected.status, "rejected");
    assert.equal(await periodStatus(s.periodId), "running");
    assert.equal(await jobCount("executeProposal"), 0);

    const again = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    assert.equal(again.status, "open");
  });

  dbTest("melewati batas waktu: suara ditolak (VOTING_CLOSED), usulan kedaluwarsa, usulan baru boleh dibuat", async () => {
    const s = await seed3();
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.pool.query("UPDATE proposals SET deadline = now() - interval '1 minute' WHERE id = $1", [pr.id]);

    // tampilan sudah menganggapnya kedaluwarsa
    assert.equal((await ctx.proposals.getProposalView(asUser(s.members[0]!), pr.id)).status, "expired");
    await assert.rejects(ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true), (e) => code(e) === "VOTING_CLOSED");
    const row = await ctx.pool.query<{ status: string }>("SELECT status FROM proposals WHERE id = $1", [pr.id]);
    assert.equal(row.rows[0]!.status, "expired");
    assert.equal(await periodStatus(s.periodId), "running"); // keputusan tidak berlaku

    const again = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    assert.equal(again.status, "open");
  });

  dbTest("semua iuran akhirnya lunas: usulan yang masih terbuka kedaluwarsa", async () => {
    const s = await seed3();
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    for (let i = 0; i < 3; i++) await pay(s, i);
    assert.equal(await periodStatus(s.periodId), "ready_payout");
    const row = await ctx.pool.query<{ status: string }>("SELECT status FROM proposals WHERE id = $1", [pr.id]);
    assert.equal(row.rows[0]!.status, "expired");
  });

  dbTest("outbox: markPayout ditahan sampai semua job kuorum kelompok itu terkonfirmasi", async () => {
    const s = await seed3();
    await pay(s, 0);
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true); // kuorum: executeProposal diantre
    await ctx.payouts.createPayout(asUser(s.members[0]!), { periodId: s.periodId, mode: "simulated" });
    assert.equal(await jobCount("markPayout"), 1);

    // Tahap 1: usulan belum on-chain. Yang boleh diambil hanya recordPayment dan proposeClosePeriod.
    const b1 = await ctx.outbox.claimJobs(20);
    assert.deepEqual(b1.map((j) => j.kind).sort(), ["proposeClosePeriod", "recordPayment"]);
    const propose = b1.find((j) => j.kind === "proposeClosePeriod")!;
    await ctx.outbox.markProposalCreated(propose.id, "7", "0x" + "ab".repeat(32));

    // Tahap 2: suara dan eksekusi dilepas, markPayout masih ditahan.
    const b2 = await ctx.outbox.claimJobs(20);
    assert.deepEqual(b2.map((j) => j.kind).sort(), ["castVote", "castVote", "executeProposal"]);
    for (const j of b2) await ctx.outbox.markJobConfirmed(j.id, "0x" + "cd".repeat(32));

    // Tahap 3: semua job kuorum terkonfirmasi, baru markPayout dilepas.
    const b3 = await ctx.outbox.claimJobs(20);
    assert.deepEqual(b3.map((j) => j.kind), ["markPayout"]);
  });

  dbTest("outbox: suara dan eksekusi ditahan sampai usulan on-chain; proposeClosePeriod dikonfirmasi lewat markProposalCreated", async () => {
    const s = await seed3(); // kelompok sudah on-chain (chain_circle_id = 1)
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, false); // masih open

    const first = await ctx.outbox.claimJobs(10);
    assert.deepEqual(first.map((j) => j.kind), ["proposeClosePeriod"]); // castVote belum boleh diambil
    await assert.rejects(ctx.outbox.markJobConfirmed(first[0]!.id, "0xabc"), (e) => code(e) === "USE_MARK_PROPOSAL_CREATED");

    await ctx.outbox.markProposalCreated(first[0]!.id, "7", "0x" + "ab".repeat(32));
    const row = await ctx.pool.query<{ chain_proposal_id: string | null }>(
      "SELECT chain_proposal_id FROM proposals WHERE id = $1",
      [pr.id],
    );
    assert.equal(row.rows[0]!.chain_proposal_id, "7");

    const second = await ctx.outbox.claimJobs(10);
    assert.deepEqual(second.map((j) => j.kind), ["castVote"]);
    const payload = second[0]!.payload as unknown as { chainProposalId: string | null; circleChainId: string | null };
    assert.equal(payload.chainProposalId, "7");
    assert.equal(payload.circleChainId, "1");
  });
});
