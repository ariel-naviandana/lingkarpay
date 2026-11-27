import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { boot, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";

/**
 * Aturan bisnis: tanggal mulai, undian giliran, usulan hanya setelah jatuh tempo, tenggat digeser
 * bila periode dibuka terlambat, pencairan oleh penerima, dan sanksi penunggak.
 * Postgres sungguhan. Dilewati otomatis bila Postgres tidak berjalan.
 */
let ready = false;
let ctx!: Awaited<ReturnType<typeof boot>>;

before(async () => {
  ready = await prepareTestDatabase();
  if (ready) ctx = await boot();
});
after(async () => {
  if (ready) await ctx.app.close();
});
beforeEach(async () => {
  if (ready) await resetDb(ctx.pool);
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
const asUser = (m: Seeded["members"][number]) => ({ id: m.userId, name: m.name, email: m.email, role: "user" as const });
const wibDate = (offsetDays = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

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
const call = (u: U, method: "GET" | "POST", url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${u.token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const acct = (name: string) => ({ channel: "BCA" as const, accountNumber: "1234567890", accountName: name });
const body = (startDate: string, memberCount = 3) => ({
  name: "Arisan Aturan",
  contributionAmount: 10000,
  memberCount,
  periodDays: 7,
  penaltyPct: 5,
  startDate,
  payoutAccount: acct("Pembuat"),
});
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;

/** Kelompok draft penuh: pembuat + anggota lain menerima undangan. */
async function fullDraft(startDate: string, n = 3, tag = "a") {
  const owner = await user(`pembuat-${tag}`);
  const cid = (await call(owner, "POST", "/circles", body(startDate, n))).json<{ id: number }>().id;
  const others: U[] = [];
  for (let i = 1; i < n; i++) {
    const u = await user(`anggota${i}-${tag}`);
    await call(owner, "POST", `/circles/${cid}/members`, { email: u.email });
    await call(u, "POST", `/circles/${cid}/invitation/accept`, { payoutAccount: acct(`Anggota ${i}`) });
    others.push(u);
  }
  return { owner, cid, others };
}

/** Periode 1 milik seed: semua lunas lalu siap cair. */
async function paidAll(s: Seeded, periodId: number) {
  for (const [i, m] of s.members.entries()) {
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ($1, $2, $3, 10000, 1000, 11000, 'ANCHORED', $1, now() + interval '1 hour', now())`,
      [`LP-rule-${periodId}-${i}`, m.memberId, periodId],
    );
  }
  await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [periodId]);
}

describe("aturan bisnis", () => {
  dbTest("tanggal mulai: tidak boleh lampau; kelompok baru bisa dikunci pada/sesudah tanggal itu", async () => {
    const a = await user("ani");
    const past = await call(a, "POST", "/circles", body(wibDate(-1)));
    assert.equal(past.statusCode, 400);
    assert.equal(errCode(past), "INVALID_START_DATE");

    const later = await fullDraft(wibDate(3));
    const detail = (await call(later.owner, "GET", `/circles/${later.cid}`)).json<{ circle: { startDate: string } }>();
    assert.equal(detail.circle.startDate, wibDate(3));
    const early = await call(later.owner, "POST", `/circles/${later.cid}/start`, {});
    assert.equal(early.statusCode, 409);
    assert.equal(errCode(early), "START_DATE_NOT_REACHED");

    const today = await fullDraft(wibDate(0), 3, "b");
    assert.equal((await call(today.owner, "POST", `/circles/${today.cid}/start`, {})).statusCode, 200);
  });

  dbTest("urutan giliran diundi: bisa dihitung ulang dari seed, urutan kiriman klien diabaikan", async () => {
    const { owner, cid } = await fullDraft(wibDate(0), 4);
    const members = (
      await ctx.pool.query<{ id: number; member_ref: string }>(
        "SELECT id, member_ref FROM members WHERE circle_id = $1 ORDER BY id",
        [cid],
      )
    ).rows;
    // Klien mencoba memaksa urutan (pembuat pertama): diabaikan.
    const forced = [...members].map((m) => m.id);
    const res = await call(owner, "POST", `/circles/${cid}/start`, { order: forced });
    assert.equal(res.statusCode, 200);

    const d = (await call(owner, "GET", `/circles/${cid}`)).json<{ circle: { drawSeed: string } }>();
    assert.match(d.circle.drawSeed, /^[0-9a-f]{64}$/);
    const expected = ctx.circles.drawTurnOrder(d.circle.drawSeed, members).map((m) => m.id);
    const actual = (
      await ctx.pool.query<{ id: number }>("SELECT id FROM members WHERE circle_id = $1 ORDER BY turn_order", [cid])
    ).rows.map((r) => r.id);
    assert.deepEqual(actual, expected);
    // Penerima periode mengikuti hasil undian.
    const recips = (
      await ctx.pool.query<{ recipient_member_id: number }>(
        "SELECT recipient_member_id FROM periods WHERE circle_id = $1 ORDER BY period_no",
        [cid],
      )
    ).rows.map((r) => r.recipient_member_id);
    assert.deepEqual(recips, expected);
  });

  dbTest("usulan tutup periode ditolak sebelum jatuh tempo", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3 });
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ('LP-due-1', $1, $2, 10000, 1000, 11000, 'ANCHORED', 'LP-due-1', now() + interval '1 hour', now())`,
      [s.members[0]!.memberId, s.periodId],
    );
    await assert.rejects(
      () => ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId),
      (e) => code(e) === "NOT_DUE_YET",
    );
  });

  dbTest("periode berikutnya yang dibuka terlambat mendapat tenggat penuh sejak dibuka", async () => {
    const s = await seedCircle(ctx.pool);
    // Tenggat periode 2 seolah sudah lewat karena pencairan periode 1 tertunda.
    await ctx.pool.query("UPDATE periods SET due_date = now() - interval '1 day' WHERE id = $1", [s.period2Id]);
    await paidAll(s, s.periodId);
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    const p2 = await ctx.pool.query<{ status: string; days_left: number; opened: boolean }>(
      `SELECT status, EXTRACT(EPOCH FROM (due_date - now())) / 86400 AS days_left, opened_at IS NOT NULL AS opened
         FROM periods WHERE id = $1`,
      [s.period2Id],
    );
    assert.equal(p2.rows[0]!.status, "running");
    assert.ok(p2.rows[0]!.opened);
    assert.ok(Number(p2.rows[0]!.days_left) > 6.99, `sisa ${p2.rows[0]!.days_left} hari`);
  });

  dbTest("tenggat yang masih jauh tidak diubah saat periode dibuka tepat waktu", async () => {
    const s = await seedCircle(ctx.pool, { dueInDays: 7 });
    const before = await ctx.pool.query<{ due_date: Date }>("SELECT due_date FROM periods WHERE id = $1", [s.period2Id]);
    await ctx.pool.query("UPDATE periods SET due_date = now() + interval '20 days' WHERE id = $1", [s.period2Id]);
    await paidAll(s, s.periodId);
    await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    const after = await ctx.pool.query<{ days_left: number }>(
      "SELECT EXTRACT(EPOCH FROM (due_date - now())) / 86400 AS days_left FROM periods WHERE id = $1",
      [s.period2Id],
    );
    assert.ok(before.rows[0]);
    assert.ok(Number(after.rows[0]!.days_left) > 19.9 && Number(after.rows[0]!.days_left) <= 20);
  });

  dbTest("penerima giliran bisa mencairkan sendiri; anggota lain tidak", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3 });
    // Penerima periode 1 bukan pembuat: jadikan anggota 2 penerimanya.
    await ctx.pool.query("UPDATE periods SET recipient_member_id = $2 WHERE id = $1", [s.periodId, s.members[1]!.memberId]);
    await paidAll(s, s.periodId);
    await assert.rejects(
      () => ctx.payouts.createPayout(asUser(s.members[2]!), { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "FORBIDDEN",
    );
    const po = await ctx.payouts.createPayout(asUser(s.members[1]!), { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
    assert.equal(po.destination?.last4, "0002");
  });

  dbTest("penunggak tidak bisa membuat kelompok atau menerima undangan baru sampai lunas", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3, dueInDays: -1 });
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ('LP-ar-b', $1, $2, 10000, 1000, 11000, 'ANCHORED', 'LP-ar-b', now() + interval '1 hour', now())`,
      [s.members[0]!.memberId, s.periodId],
    );
    const pr = await ctx.proposals.createClosePeriodProposal(asUser(s.members[0]!), s.periodId);
    await ctx.proposals.castVote(asUser(s.members[0]!), pr.id, true);
    await ctx.proposals.castVote(asUser(s.members[1]!), pr.id, true);
    // Anggota 3 menunggak.
    const debtor = s.members[2]!;
    await assert.rejects(
      () =>
        ctx.circles.createCircle(debtor.userId, {
          name: "Baru",
          contributionAmount: 10000,
          memberCount: 2,
          periodDays: 7,
          penaltyPct: 0,
          startDate: wibDate(0),
          payoutAccount: acct("Debitur"),
        }),
      (e) => code(e) === "HAS_OPEN_ARREARS",
    );
    const other = await user("pembuatlain");
    const cid = (await call(other, "POST", "/circles", body(wibDate(0), 2))).json<{ id: number }>().id;
    await ctx.circles.addMemberByEmail(other.id, cid, debtor.email);
    await assert.rejects(
      () => ctx.circles.acceptInvitation(debtor.userId, cid, acct("Debitur")),
      (e) => code(e) === "HAS_OPEN_ARREARS",
    );

    // Setelah lunas, boleh bergabung.
    await ctx.pool.query("UPDATE arrears SET status = 'paid' WHERE debtor_member_id = $1", [debtor.memberId]);
    const ok = await ctx.circles.acceptInvitation(debtor.userId, cid, acct("Debitur"));
    assert.equal(ok.status, "active");
  });
});
