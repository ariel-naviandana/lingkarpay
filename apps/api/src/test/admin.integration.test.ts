import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { boot, prepareTestDatabase, resetDb, seedCircle } from "./helpers.js";

/**
 * Tes peran admin dengan Postgres sungguhan: login nyata (token sesi), bukan klaim dari klien.
 * Dilewati otomatis bila Postgres tidak berjalan.
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

async function signup(name: string, email: string) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name, email, password: "rahasia1234" },
  });
  assert.equal(res.statusCode, 201);
  return res.json<{ user: { id: number; role: string }; token: string }>();
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("peran admin", () => {
  dbTest("pengguna baru berperan user, walau emailnya diawali 'admin'", async () => {
    const a = await signup("Admin Palsu", "admin@contoh.id");
    assert.equal(a.user.role, "user");
    const me = await ctx.app.inject({ method: "GET", url: "/auth/me", headers: auth(a.token) });
    assert.equal(me.json<{ user: { role: string } }>().user.role, "user");
  });

  dbTest("/admin/circles: user biasa 403, tanpa login 401, admin boleh", async () => {
    await seedCircle(ctx.pool);
    const u = await signup("Budi", "budi@contoh.id");
    const none = await ctx.app.inject({ method: "GET", url: "/admin/circles" });
    assert.equal(none.statusCode, 401);
    const denied = await ctx.app.inject({ method: "GET", url: "/admin/circles", headers: auth(u.token) });
    assert.equal(denied.statusCode, 403);

    await ctx.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.user.id]);
    const ok = await ctx.app.inject({ method: "GET", url: "/admin/circles", headers: auth(u.token) });
    assert.equal(ok.statusCode, 200);
    const body = ok.json<{ circles: Array<Record<string, unknown>> }>();
    assert.equal(body.circles.length, 1);
    assert.equal(typeof body.circles[0]!.creatorName, "string");
    assert.ok(!JSON.stringify(body).includes("example.com")); // tanpa email
  });

  dbTest("laporan rekonsiliasi: admin boleh untuk kelompok siapa pun, user biasa yang bukan pembuat tetap 403", async () => {
    const s = await seedCircle(ctx.pool);
    const outsider = await signup("Citra", "citra@contoh.id");
    const url = `/reports/reconciliation?circleId=${s.circleId}&live=false`;
    const denied = await ctx.app.inject({ method: "GET", url, headers: auth(outsider.token) });
    assert.equal(denied.statusCode, 403);

    await ctx.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [outsider.user.id]);
    const ok = await ctx.app.inject({ method: "GET", url, headers: auth(outsider.token) });
    assert.equal(ok.statusCode, 200);
  });

  dbTest("peran admin tidak memberi hak mencairkan kelompok orang lain", async () => {
    const s = await seedCircle(ctx.pool);
    const adm = await signup("Admin", "admin2@contoh.id");
    await ctx.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adm.user.id]);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/payouts/simulate",
      headers: auth(adm.token),
      payload: { periodId: s.periodId },
    });
    assert.equal(res.statusCode, 403);
  });
});
