import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { prepareTestDatabase, resetDb } from "./helpers.js";

/**
 * Batas laju login/registrasi dan header keamanan, dengan Postgres sungguhan.
 * Aplikasi dibangun dengan batas kecil agar mudah diuji. Dilewati bila Postgres tidak berjalan.
 */
let ready = false;
let app!: FastifyInstance;
let pool!: Pool;

before(async () => {
  ready = await prepareTestDatabase();
  if (!ready) return;
  const { buildApp } = await import("../app.js");
  const db = await import("../db/pool.js");
  const { runMigrations } = await import("../db/migrations.js");
  pool = db.pool;
  await runMigrations(pool);
  app = await buildApp({
    authRateLimit: {
      login: { max: 3, windowMs: 60_000 },
      register: { max: 2, windowMs: 60_000 },
    },
  });
  await app.ready();
});
after(async () => {
  if (ready) await app.close();
});
beforeEach(async () => {
  if (ready) await resetDb(pool);
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

const register = (email: string, remoteAddress = "10.0.0.1") =>
  app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress,
    payload: { name: "Uji", email, password: "rahasia1234" },
  });

const login = (email: string, password: string, remoteAddress = "10.0.0.1") =>
  app.inject({ method: "POST", url: "/auth/login", remoteAddress, payload: { email, password } });

describe("keamanan: batas laju dan header", () => {
  dbTest("login gagal berulang diblokir 429 dengan Retry-After, walau kata sandi benar", async () => {
    assert.equal((await register("ani@contoh.id", "10.0.0.9")).statusCode, 201);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await login("ani@contoh.id", "salah-sandi")).statusCode, 401);
    }
    const blocked = await login("ani@contoh.id", "rahasia1234");
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json<{ error: { code: string } }>().error.code, "RATE_LIMITED");
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    assert.match(blocked.json<{ error: { message: string } }>().error.message, /sekitar 1 menit/);
    // IP lain untuk email yang sama tidak ikut terblokir.
    assert.equal((await login("ani@contoh.id", "rahasia1234", "10.0.0.2")).statusCode, 200);
  });

  dbTest("login berhasil mereset hitungan gagal", async () => {
    assert.equal((await register("budi@contoh.id", "10.0.0.9")).statusCode, 201);
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await login("budi@contoh.id", "salah-sandi")).statusCode, 401);
    }
    assert.equal((await login("budi@contoh.id", "rahasia1234")).statusCode, 200);
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await login("budi@contoh.id", "salah-sandi")).statusCode, 401);
    }
    assert.equal((await login("budi@contoh.id", "rahasia1234")).statusCode, 200);
  });

  dbTest("registrasi per IP dibatasi", async () => {
    assert.equal((await register("a1@contoh.id")).statusCode, 201);
    assert.equal((await register("a2@contoh.id")).statusCode, 201);
    const blocked = await register("a3@contoh.id");
    assert.equal(blocked.statusCode, 429);
    assert.equal((await register("a3@contoh.id", "10.0.0.3")).statusCode, 201);
  });

  dbTest("header keamanan ada di respons sukses dan error", async () => {
    for (const res of [
      await app.inject({ method: "GET", url: "/health" }),
      await app.inject({ method: "GET", url: "/auth/me" }),
    ]) {
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["referrer-policy"], "no-referrer");
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.headers["access-control-allow-origin"], undefined);
    }
  });
});
