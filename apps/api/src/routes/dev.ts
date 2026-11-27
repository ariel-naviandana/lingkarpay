import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { createSnapTransaction, ENABLED_PAYMENTS } from "../services/midtrans.js";
import { requireUser } from "../lib/auth.js";
import { conflict } from "../lib/errors.js";
import { pool, withTx } from "../db/pool.js";
import { settleDepositByOrder } from "../services/deposits.js";
import { requireMember } from "../services/circles.js";

// Alat bantu pengembangan (spike). Hanya aktif bila DEV_TOOLS=true.
export async function devRoutes(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(`<!doctype html><html><body>
    <button id="pay">Bayar Rp10.000 (tes)</button>
    <script src="https://app.sandbox.midtrans.com/snap/snap.js" data-client-key="${config.MIDTRANS_CLIENT_KEY}"></script>
    <script>
      document.getElementById('pay').onclick = async () => {
        const orderId = 'TEST-' + Date.now();
        const r = await fetch('/dev/checkout', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, amount: 10000, email: 'tes@example.com' }) });
        const { token } = await r.json();
        snap.pay(token);
      };
    </script></body></html>`);
  });

  // Simulasi waktu (sandbox): jadikan periode berjalan sudah lewat jatuh tempo, agar alur kuorum
  // dan tunggakan bisa didemokan tanpa menunggu berhari-hari. Hanya anggota kelompok itu.
  // Tidak mengubah contract; penalti dan usulan kuorum dihitung di backend.
  app.post("/dev/periods/:id/make-overdue", async (req) => {
    const user = await requireUser(req);
    const periodId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(periodId) || periodId <= 0) throw conflict("NOT_FOUND", "Periode tidak ditemukan");
    const p = await pool.query<{ circle_id: number; status: string }>(
      "SELECT circle_id, status FROM periods WHERE id = $1",
      [periodId],
    );
    if (!p.rows[0]) throw conflict("NOT_FOUND", "Periode tidak ditemukan");
    await requireMember(pool, p.rows[0].circle_id, user.id);
    if (p.rows[0].status !== "running") throw conflict("PERIOD_NOT_OPEN", "Periode tidak sedang berjalan");
    await pool.query("UPDATE periods SET due_date = now() - interval '1 minute' WHERE id = $1", [periodId]);
    return { periodId, overdue: true, simulated: true };
  });

  // Simulasi sandbox: tandai jaminan anggota yang login sudah disetor tanpa melewati Midtrans, agar skrip
  // smoke tidak perlu membayar jaminan setiap anggota di simulator. Order dicatat dengan payment_type
  // "dev_simulated" supaya terlihat jelas di riwayat dan rekonsiliasi. Jalur sungguhan: /circles/:id/deposit/checkout.
  app.post("/dev/circles/:id/deposit/simulate", async (req) => {
    const user = await requireUser(req);
    const circleId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(circleId) || circleId <= 0) throw conflict("NOT_FOUND", "Kelompok tidak ditemukan");
    const memberId = await requireMember(pool, circleId, user.id);
    return withTx(async (client) => {
      const c = await client.query<{ status: string; deposit_amount: number }>(
        "SELECT status, deposit_amount FROM circles WHERE id = $1 FOR UPDATE",
        [circleId],
      );
      if (c.rows[0]!.status !== "draft") throw conflict("CIRCLE_STARTED", "Jaminan disetor sebelum kelompok dikunci");
      const amount = Number(c.rows[0]!.deposit_amount);
      if (amount <= 0) throw conflict("DEPOSIT_NOT_REQUIRED", "Kelompok ini tidak memakai dana jaminan");
      const done = await client.query("SELECT 1 FROM deposits WHERE member_id = $1", [memberId]);
      if (done.rowCount) throw conflict("ALREADY_PAID", "Dana jaminan Anda sudah disetor");
      const orderId = `LP-${circleId}-J-${memberId}-dev${Date.now().toString(36)}`;
      const o = await client.query<{ id: number }>(
        `INSERT INTO orders (order_id, member_id, period_id, kind, amount, penalty_amount, admin_fee, gross_amount,
                             status, idempotency_key, expires_at, paid_at, payment_type)
         VALUES ($1, $2, NULL, 'deposit', $3, 0, 0, $3, 'SETTLED', $1, now(), now(), 'dev_simulated')
         RETURNING id`,
        [orderId, memberId, amount],
      );
      await settleDepositByOrder(client, o.rows[0]!.id);
      return { circleId, memberId, amount, orderId, simulated: true };
    });
  });

  app.post("/dev/checkout", async (req) => {
    const { orderId, amount, email } = req.body as {
      orderId: string;
      amount: number;
      email: string;
    };
    const t = await createSnapTransaction({
      orderId,
      grossAmount: amount,
      customer: { firstName: "Tes", email },
      expiryMinutes: config.ORDER_EXPIRY_MINUTES,
      enabledPayments: ENABLED_PAYMENTS,
    });
    return { token: t.token, redirect_url: t.redirectUrl };
  });
}
