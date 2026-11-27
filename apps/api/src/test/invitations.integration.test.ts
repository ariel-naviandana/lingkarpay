import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { boot, prepareTestDatabase, resetDb } from "./helpers.js";

/**
 * Biaya admin tetap dari aplikasi dan alur undangan (terima dengan rekening, tolak, batalkan),
 * lewat HTTP dengan Postgres sungguhan. Dilewati otomatis bila Postgres tidak berjalan.
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

const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const acct = (name: string) => ({ channel: "BCA", accountNumber: "1234567890", accountName: name });
const circleBody = (extra: Record<string, unknown> = {}) => ({
  name: "Arisan Uji",
  contributionAmount: 10000,
  memberCount: 3,
  periodDays: 7,
  penaltyPct: 5,
  startDate: todayWib(),
  payoutAccount: acct("Pembuat"),
  ...extra,
});
const code = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;

describe("biaya admin dan undangan", () => {
  dbTest("biaya admin ditetapkan aplikasi: nilai dari klien diabaikan", async () => {
    const a = await user("ani");
    const res = await call(a, "POST", "/circles", circleBody({ adminFee: 99999 }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.json<{ adminFee: number }>().adminFee, 1000);
  });

  dbTest("membuat kelompok wajib mengisi rekening pembuat", async () => {
    const a = await user("ani");
    const { payoutAccount: _omit, ...noAccount } = circleBody();
    assert.equal((await call(a, "POST", "/circles", noAccount)).statusCode, 400);
    const bad = await call(a, "POST", "/circles", circleBody({ payoutAccount: { ...acct("x"), accountNumber: "12ab" } }));
    assert.equal(bad.statusCode, 400);
    const ok = await call(a, "POST", "/circles", circleBody());
    const detail = await call(a, "GET", `/circles/${ok.json<{ id: number }>().id}`);
    const me = detail.json<{ members: { isMe: boolean; payoutAccount: { last4: string } | null }[] }>().members.find((m) => m.isMe)!;
    assert.equal(me.payoutAccount?.last4, "7890");
  });

  dbTest("undangan: diundang belum jadi anggota; start ditolak sampai semua menerima dengan rekening", async () => {
    const [a, b, c] = [await user("ani"), await user("budi"), await user("citra")];
    const cid = (await call(a, "POST", "/circles", circleBody())).json<{ id: number }>().id;
    const inv = await call(a, "POST", `/circles/${cid}/members`, { email: b.email });
    assert.equal(inv.statusCode, 201);
    assert.equal(inv.json<{ status: string }>().status, "invited");
    await call(a, "POST", `/circles/${cid}/members`, { email: c.email });

    // Yang diundang melihat undangan, belum melihat kelompok sebagai anggota.
    const list = await call(b, "GET", "/invitations");
    const invs = list.json<{ invitations: { circle: { id: number; adminFee: number }; creatorName: string }[] }>().invitations;
    assert.equal(invs.length, 1);
    assert.equal(invs[0]!.circle.id, cid);
    assert.equal(invs[0]!.creatorName, "ani");
    assert.equal((await call(b, "GET", `/circles/${cid}`)).statusCode, 403);
    assert.equal((await call(b, "GET", "/circles")).json<{ circles: unknown[] }>().circles.length, 0);

    // Pembuat melihat status undangan; kelompok belum bisa dimulai.
    const d = (await call(a, "GET", `/circles/${cid}`)).json<{ members: { status: string }[] }>();
    assert.deepEqual(d.members.map((m) => m.status).sort(), ["active", "invited", "invited"]);
    const early = await call(a, "POST", `/circles/${cid}/start`, {});
    assert.equal(early.statusCode, 409);
    assert.equal(code(early), "INVITES_PENDING");

    // Menerima tanpa rekening ditolak; dengan rekening diterima.
    assert.equal((await call(b, "POST", `/circles/${cid}/invitation/accept`, {})).statusCode, 400);
    const acc = await call(b, "POST", `/circles/${cid}/invitation/accept`, { payoutAccount: { channel: "OVO", accountNumber: "081234567890", accountName: "Budi" } });
    assert.equal(acc.statusCode, 200);
    assert.equal((await call(b, "GET", `/circles/${cid}`)).statusCode, 200);
    assert.equal((await call(c, "POST", `/circles/${cid}/invitation/accept`, { payoutAccount: acct("Citra") })).statusCode, 200);

    const started = await call(a, "POST", `/circles/${cid}/start`, {});
    assert.equal(started.statusCode, 200);
    // Semua anggota punya rekening sejak bergabung.
    const n = await ctx.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM members WHERE circle_id = $1 AND payout_channel IS NULL",
      [cid],
    );
    assert.equal(n.rows[0]!.n, 0);
  });

  dbTest("menolak undangan mengosongkan kursi; pembuat bisa membatalkan undangan", async () => {
    const [a, b, c, d] = [await user("ani"), await user("budi"), await user("citra"), await user("dodi")];
    const cid = (await call(a, "POST", "/circles", circleBody())).json<{ id: number }>().id;
    await call(a, "POST", `/circles/${cid}/members`, { email: b.email });
    const ic = (await call(a, "POST", `/circles/${cid}/members`, { email: c.email })).json<{ memberId: number }>();
    // Kursi penuh (1 anggota + 2 undangan).
    const full = await call(a, "POST", `/circles/${cid}/members`, { email: d.email });
    assert.equal(code(full), "CIRCLE_FULL");

    assert.equal((await call(b, "POST", `/circles/${cid}/invitation/decline`)).statusCode, 200);
    assert.equal((await call(b, "GET", "/invitations")).json<{ invitations: unknown[] }>().invitations.length, 0);
    assert.equal((await call(b, "POST", `/circles/${cid}/invitation/decline`)).statusCode, 404);

    // Yang bukan pembuat tidak bisa membatalkan; pembuat bisa.
    assert.equal((await call(b, "DELETE", `/circles/${cid}/invitations/${ic.memberId}`)).statusCode, 403);
    assert.equal((await call(a, "DELETE", `/circles/${cid}/invitations/${ic.memberId}`)).statusCode, 200);
    assert.equal((await call(c, "GET", "/invitations")).json<{ invitations: unknown[] }>().invitations.length, 0);

    // Kursi kosong lagi: bisa mengundang orang lain, termasuk mengundang ulang yang menolak.
    assert.equal((await call(a, "POST", `/circles/${cid}/members`, { email: d.email })).statusCode, 201);
    assert.equal((await call(a, "POST", `/circles/${cid}/members`, { email: b.email })).statusCode, 201);
  });
});
