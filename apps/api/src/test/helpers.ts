import "dotenv/config";
import pg from "pg";
import type { Pool } from "pg";
import { computeSignature } from "../lib/signature.js";

// Kunci palsu khusus tes. Menimpa isi .env agar tes tidak pernah memakai key Midtrans sungguhan.
export const TEST_SERVER_KEY = "FAKE-SERVER-KEY-UNIT-TESTS-ONLY";
export const TEST_SIGNATURE_KEY = "UNIT-TEST-SIGNATURE-SECRET-KEY";

/**
 * Menyiapkan database uji dan environment. Harus dipanggil SEBELUM modul aplikasi di-import.
 * Mengembalikan false bila Postgres tidak bisa dihubungi (tes database dilewati).
 *
 * Database uji: TEST_DATABASE_URL, atau DATABASE_URL dengan nama database diganti
 * "lingkarpay_test". Nama harus berakhiran "_test" karena tes menghapus seluruh isinya.
 */
export async function prepareTestDatabase(): Promise<boolean> {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) return false;

  const testUrl = new URL(base);
  if (!explicit) testUrl.pathname = "/lingkarpay_test";
  const dbName = decodeURIComponent(testUrl.pathname.slice(1));
  if (!/_test$/.test(dbName)) {
    throw new Error(`Database uji harus berakhiran "_test" (sekarang "${dbName}"). Tes dibatalkan.`);
  }

  try {
    const adminUrl = new URL(testUrl.toString());
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
      if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
    } finally {
      await admin.end();
    }
  } catch {
    return false;
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testUrl.toString();
  process.env.MIDTRANS_SERVER_KEY = TEST_SERVER_KEY;
  process.env.MIDTRANS_CLIENT_KEY = "FAKE-CLIENT-KEY-UNIT-TESTS-ONLY";
  process.env.MIDTRANS_SIGNATURE_KEY = TEST_SIGNATURE_KEY;
  process.env.DEV_TOOLS = "false";
  process.env.IRIS_ENABLED = "false";
  process.env.ORDER_EXPIRY_MINUTES = "60";
  process.env.DEFAULT_ADMIN_FEE = "1000";
  // Tes tidak boleh membaca contract sungguhan dari .env; tes gerbang chain memakai pembaca palsu.
  process.env.PAYOUT_CHAIN_CHECK = "off";
  return true;
}

/** Mengimpor modul aplikasi setelah environment uji siap, lalu menyiapkan skema database. */
export async function boot() {
  const { buildApp } = await import("../app.js");
  const { pool } = await import("../db/pool.js");
  const { runMigrations } = await import("../db/migrations.js");
  const checkout = await import("../services/checkout.js");
  const midtrans = await import("../services/midtrans.js");
  const outbox = await import("../services/outbox.js");
  const payouts = await import("../services/payouts.js");
  const reconciliation = await import("../services/reconciliation.js");
  const circles = await import("../services/circles.js");
  const orders = await import("../services/orders.js");
  const proposals = await import("../services/proposals.js");
  await runMigrations(pool);
  const app = await buildApp();
  await app.ready();
  return { app, pool, checkout, midtrans, outbox, payouts, reconciliation, circles, orders, proposals };
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE users, sessions, circles, members, periods, orders, order_status_history,
              webhook_events, payouts, chain_jobs, chain_transactions, proposals, proposal_votes
     RESTART IDENTITY CASCADE`,
  );
}

export interface SeedOptions {
  memberCount?: number;
  contribution?: number;
  penaltyPct?: number;
  adminFee?: number;
  /** Tenggat periode 1 dari sekarang (hari). Negatif = sudah lewat. */
  dueInDays?: number;
  /** ID kelompok on-chain. Bawaan "1" (sudah on-chain); null = belum dibuat di chain. */
  chainCircleId?: string | null;
  /** Anggota sudah mengisi rekening pencairan dummy (BCA ...000N). Bawaan true. */
  payoutAccounts?: boolean;
}

export interface SeededMember {
  memberId: number;
  userId: number;
  name: string;
  email: string;
}

export interface Seeded {
  circleId: number;
  periodId: number;
  period2Id: number;
  members: SeededMember[];
  owner: { id: number; name: string; email: string; role: "user" };
}

/** Membuat kelompok aktif dengan anggota dan dua periode (periode 1 berjalan). */
export async function seedCircle(pool: Pool, opts: SeedOptions = {}): Promise<Seeded> {
  const n = opts.memberCount ?? 2;
  const contribution = opts.contribution ?? 10000;
  const penaltyPct = opts.penaltyPct ?? 5;
  const adminFee = opts.adminFee ?? 1000;
  const dueInDays = opts.dueInDays ?? 7;
  const chainCircleId = opts.chainCircleId === undefined ? "1" : opts.chainCircleId;
  const withAccounts = opts.payoutAccounts ?? true;

  const users: Array<{ id: number; name: string; email: string }> = [];
  for (let i = 1; i <= n; i++) {
    const r = await pool.query<{ id: number }>(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id",
      [`User ${i}`, `user${i}@example.com`],
    );
    users.push({ id: r.rows[0]!.id, name: `User ${i}`, email: `user${i}@example.com` });
  }

  const c = await pool.query<{ id: number }>(
    `INSERT INTO circles (name, contribution_amount, member_count, period_days, penalty_pct,
                          admin_fee, status, started_at, created_by, chain_circle_id)
     VALUES ('Uji', $1, $2, 7, $3, $4, 'active', now(), $5, $6) RETURNING id`,
    [contribution, n, penaltyPct, adminFee, users[0]!.id, chainCircleId],
  );
  const circleId = c.rows[0]!.id;

  const members: SeededMember[] = [];
  for (let i = 0; i < n; i++) {
    const m = await pool.query<{ id: number }>(
      `INSERT INTO members (circle_id, user_id, member_ref, turn_order,
                            payout_channel, payout_account_last4, payout_account_name, payout_account_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      withAccounts
        ? [circleId, users[i]!.id, `m_test${i + 1}`, i + 1, "BCA", `000${i + 1}`, users[i]!.name, `0xtest${i + 1}`]
        : [circleId, users[i]!.id, `m_test${i + 1}`, i + 1, null, null, null, null],
    );
    members.push({ memberId: m.rows[0]!.id, userId: users[i]!.id, name: users[i]!.name, email: users[i]!.email });
  }

  const p1 = await pool.query<{ id: number }>(
    `INSERT INTO periods (circle_id, period_no, due_date, status, recipient_member_id)
     VALUES ($1, 1, now() + make_interval(days => $2), 'running', $3) RETURNING id`,
    [circleId, dueInDays, members[0]!.memberId],
  );
  const p2 = await pool.query<{ id: number }>(
    `INSERT INTO periods (circle_id, period_no, due_date, status, recipient_member_id)
     VALUES ($1, 2, now() + make_interval(days => $2), 'scheduled', $3) RETURNING id`,
    [circleId, dueInDays + 7, members[n > 1 ? 1 : 0]!.memberId],
  );

  return {
    circleId,
    periodId: p1.rows[0]!.id,
    period2Id: p2.rows[0]!.id,
    members,
    owner: { ...users[0]!, role: "user" as const },
  };
}

export type NotificationStatus = "pending" | "settlement" | "expire" | "deny" | "cancel";

const STATUS_CODE: Record<NotificationStatus, string> = {
  pending: "201",
  settlement: "200",
  expire: "407",
  deny: "202",
  cancel: "202",
};

/**
 * Membuat payload notifikasi Midtrans yang bertanda tangan.
 * - extra: menimpa field (signature dihitung dari nilai akhirnya)
 * - signWith: kunci penanda tangan (bawaan: Signature Secret Key uji)
 * - badSignature: mengganti signature dengan nilai palsu
 */
export function notification(
  order: { orderId: string; grossAmount: number },
  status: NotificationStatus,
  options: { extra?: Record<string, unknown>; signWith?: string; badSignature?: boolean } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transaction_time: "2026-11-08 10:00:00",
    transaction_status: status,
    transaction_id: `trx-${order.orderId}-${status}`,
    status_message: "midtrans payment notification",
    status_code: STATUS_CODE[status],
    payment_type: "bank_transfer",
    order_id: order.orderId,
    merchant_id: "G000000000",
    gross_amount: `${order.grossAmount}.00`,
    fraud_status: "accept",
    currency: "IDR",
    ...options.extra,
  };
  body.signature_key = options.badSignature
    ? "0".repeat(128)
    : computeSignature(
        String(body.order_id),
        String(body.status_code),
        String(body.gross_amount),
        options.signWith ?? TEST_SIGNATURE_KEY,
      );
  return body;
}

/** Jaminan semua anggota aktif kelompok draft dianggap sudah disetor (langsung di database, tanpa Midtrans). */
export async function markDepositsPaid(pool: Pool, circleId: number): Promise<void> {
  const { rows } = await pool.query<{ id: number; deposit_amount: number }>(
    `SELECT m.id, c.deposit_amount FROM members m JOIN circles c ON c.id = m.circle_id
      WHERE m.circle_id = $1 AND m.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM deposits d WHERE d.member_id = m.id)`,
    [circleId],
  );
  for (const r of rows) {
    if (Number(r.deposit_amount) <= 0) continue;
    const key = `LP-${circleId}-J-${r.id}-test`;
    const o = await pool.query<{ id: number }>(
      `INSERT INTO orders (order_id, member_id, period_id, kind, amount, gross_amount, status, idempotency_key,
                           expires_at, paid_at)
       VALUES ($1, $2, NULL, 'deposit', $3, $3, 'SETTLED', $1, now(), now()) RETURNING id`,
      [key, r.id, r.deposit_amount],
    );
    await pool.query(
      "INSERT INTO deposits (member_id, circle_id, order_id, amount) VALUES ($1, $2, $3, $4)",
      [r.id, circleId, o.rows[0]!.id, r.deposit_amount],
    );
  }
}
