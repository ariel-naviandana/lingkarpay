import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { boot, prepareTestDatabase, resetDb, seedCircle, type Seeded } from "./helpers.js";

/**
 * Rekening pencairan anggota dan tujuan transfer simulasi, dengan Postgres sungguhan.
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

const code = (e: unknown) => (e as { code?: string }).code;

/** Sesi login untuk user (token acak, disimpan sebagai hash seperti aslinya). */
async function tokenFor(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await ctx.pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [createHash("sha256").update(token).digest("hex"), userId],
  );
  return token;
}

/** Periode 1 siap cair di database: semua anggota lunas. */
async function readyInDb(s: Seeded) {
  for (const [i, m] of s.members.entries()) {
    await ctx.pool.query(
      `INSERT INTO orders (order_id, member_id, period_id, amount, admin_fee, gross_amount, status,
                           idempotency_key, expires_at, paid_at)
       VALUES ($1, $2, $3, 10000, 1000, 11000, 'ANCHORED', $1, now() + interval '1 hour', now())`,
      [`LP-acct-${s.circleId}-${i}`, m.memberId, s.periodId],
    );
  }
  await ctx.pool.query("UPDATE periods SET status = 'ready_payout' WHERE id = $1", [s.periodId]);
}

const put = (token: string, circleId: number, payload: unknown) =>
  ctx.app.inject({
    method: "PUT",
    url: `/circles/${circleId}/payout-account`,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });

describe("rekening pencairan dan tujuan transfer", () => {
  dbTest("anggota mengisi rekening sendiri: tersimpan tersamar, nomor lengkap tidak disimpan", async () => {
    const s = await seedCircle(ctx.pool, { payoutAccounts: false });
    const t = await tokenFor(s.members[1]!.userId);
    const res = await put(t, s.circleId, { channel: "BNI", accountNumber: "1234-5678-90", accountName: "Budi Santoso" });
    assert.equal(res.statusCode, 200);
    const acct = res.json<{ payoutAccount: { channel: string; channelLabel: string; last4: string; accountName: string } }>()
      .payoutAccount;
    assert.deepEqual(
      { channel: acct.channel, label: acct.channelLabel, last4: acct.last4, name: acct.accountName },
      { channel: "BNI", label: "BNI", last4: "7890", name: "Budi Santoso" },
    );
    const row = (
      await ctx.pool.query<Record<string, string>>(
        "SELECT payout_account_last4, payout_account_hash FROM members WHERE id = $1",
        [s.members[1]!.memberId],
      )
    ).rows[0]!;
    assert.equal(row.payout_account_last4, "7890");
    assert.match(row.payout_account_hash!, /^0x[0-9a-f]{64}$/);
    const all = JSON.stringify((await ctx.pool.query("SELECT * FROM members")).rows);
    assert.ok(!all.includes("1234567890"), "nomor lengkap tidak boleh tersimpan");
  });

  dbTest("validasi: nomor bank harus angka, e-wallet harus nomor ponsel 08...", async () => {
    const s = await seedCircle(ctx.pool, { payoutAccounts: false });
    const t = await tokenFor(s.members[0]!.userId);
    const bad = await put(t, s.circleId, { channel: "BCA", accountNumber: "12AB5678", accountName: "Ani" });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json<{ error: { code: string } }>().error.code, "INVALID_ACCOUNT_NUMBER");
    const badWallet = await put(t, s.circleId, { channel: "GOPAY", accountNumber: "1234567890", accountName: "Ani" });
    assert.equal(badWallet.statusCode, 400);
    const okWallet = await put(t, s.circleId, { channel: "GOPAY", accountNumber: "081234567890", accountName: "Ani" });
    assert.equal(okWallet.statusCode, 200);
    const unknown = await put(t, s.circleId, { channel: "XYZ", accountNumber: "1234567890", accountName: "Ani" });
    assert.equal(unknown.statusCode, 400);
  });

  dbTest("bukan anggota tidak bisa mengisi rekening di kelompok orang lain", async () => {
    const s = await seedCircle(ctx.pool);
    const outsider = await ctx.pool.query<{ id: number }>(
      "INSERT INTO users (name, email, password_hash) VALUES ('Luar', 'luar@example.com', 'x') RETURNING id",
    );
    const res = await put(await tokenFor(outsider.rows[0]!.id), s.circleId, {
      channel: "BCA", accountNumber: "1234567890", accountName: "Luar",
    });
    assert.equal(res.statusCode, 403);
  });

  dbTest("pencairan ditolak bila penerima belum mengisi rekening", async () => {
    const s = await seedCircle(ctx.pool, { payoutAccounts: false });
    await readyInDb(s);
    await assert.rejects(
      () => ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" }),
      (e) => code(e) === "PAYOUT_ACCOUNT_REQUIRED" && /User 1/.test((e as Error).message),
    );
    const n = await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM payouts");
    assert.equal(n.rows[0]!.n, 0);
  });

  dbTest("pencairan simulasi mencatat tujuan transfer dan nomor referensi; riwayat tidak berubah saat rekening diganti", async () => {
    const s = await seedCircle(ctx.pool, { payoutAccounts: false });
    const recipient = s.members[0]!;
    const t = await tokenFor(recipient.userId);
    assert.equal((await put(t, s.circleId, { channel: "MANDIRI", accountNumber: "1300012345678", accountName: "User 1" })).statusCode, 200);
    await readyInDb(s);

    const po = await ctx.payouts.createPayout(s.owner, { periodId: s.periodId, mode: "simulated" });
    assert.equal(po.status, "SIMULATED");
    assert.equal(po.destination?.channelLabel, "Mandiri");
    assert.equal(po.destination?.last4, "5678");
    assert.equal(po.destination?.accountName, "User 1");
    assert.match(po.transferRef ?? "", new RegExp(`^SIM-TRF-\\d{8}-${s.circleId}-1$`));
    assert.ok(po.transferredAt);

    // Hash rekening ikut ke payload outbox markPayout (tanpa nomor rekening).
    const job = await ctx.pool.query<{ payload: { recipientAccountHash: string | null } }>(
      "SELECT payload FROM chain_jobs WHERE kind = 'markPayout'",
    );
    assert.match(job.rows[0]!.payload.recipientAccountHash ?? "", /^0x[0-9a-f]{64}$/);

    // Penerima mengganti rekening sesudahnya: riwayat pencairan tetap memakai tujuan lama.
    assert.equal((await put(t, s.circleId, { channel: "OVO", accountNumber: "081299990000", accountName: "User 1" })).statusCode, 200);
    const hist = await ctx.circles.circlePayments(s.owner.id, s.circleId);
    const p1 = hist.payouts.find((p) => p.periodNo === 1)!;
    assert.equal(p1.destination?.channel, "MANDIRI");
    assert.equal(p1.destination?.last4, "5678");
    assert.equal(p1.transferRef, po.transferRef);
  });

  dbTest("detail kelompok: rekening tersamar terlihat oleh pemiliknya dan pembuat, anggota lain hanya tahu sudah diisi", async () => {
    const s = await seedCircle(ctx.pool, { memberCount: 3 });
    const asCreator = await ctx.circles.getCircleDetail(s.owner.id, s.circleId);
    assert.ok(asCreator.members.every((m) => m.payoutAccount !== null));

    const asMember2 = await ctx.circles.getCircleDetail(s.members[1]!.userId, s.circleId);
    const self = asMember2.members.find((m) => m.isMe)!;
    const other = asMember2.members.find((m) => m.memberId === s.members[2]!.memberId)!;
    assert.equal(self.payoutAccount?.last4, "0002");
    assert.equal(other.payoutAccount, null);
    assert.equal(other.hasPayoutAccount, true);
  });
});
