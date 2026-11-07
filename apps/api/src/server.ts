import "dotenv/config";
import Fastify from "fastify";
import { createHash } from "node:crypto";

const app = Fastify({ logger: true });
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY!;
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY!;
const SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";

// Halaman tes sederhana
app.get("/", async (_req, reply) => {
  reply.type("text/html").send(`<!doctype html><html><body>
    <button id="pay">Bayar Rp10.000</button>
    <script src="https://app.sandbox.midtrans.com/snap/snap.js" data-client-key="${CLIENT_KEY}"></script>
    <script>
      document.getElementById('pay').onclick = async () => {
        const orderId = 'TEST-' + Date.now();
        const r = await fetch('/checkout', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, amount: 10000, email: 'tes@example.com' }) });
        const { token } = await r.json();
        snap.pay(token);
      };
    </script></body></html>`);
});

// Minta token Snap
app.post("/checkout", async (req, reply) => {
  const { orderId, amount, email } = req.body as {
    orderId: string;
    amount: number;
    email: string;
  };
  const res = await fetch(SNAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization:
        "Basic " + Buffer.from(SERVER_KEY + ":").toString("base64"),
    },
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: amount },
      customer_details: { email },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    req.log.error({ status: res.status, data }, "midtrans error");
    return reply.code(502).send(data);
  }
  if (!res.ok) return reply.code(502).send(data);
  return { token: data.token, redirect_url: data.redirect_url };
});

// Webhook (dipakai di Spike B)
app.post("/midtrans-webhook", async (req, reply) => {
  const b = (req.body ?? {}) as any;
  const expected = createHash("sha512")
    .update(
      String(b.order_id) +
        String(b.status_code) +
        String(b.gross_amount) +
        SERVER_KEY,
    )
    .digest("hex");
  req.log.info(
    {
      order_id: b.order_id,
      status_code: b.status_code,
      gross_amount: b.gross_amount,
      gross_amount_type: typeof b.gross_amount,
      status: b.transaction_status,
      got: String(b.signature_key).slice(0, 12),
      expected: expected.slice(0, 12),
    },
    "webhook DITERIMA",
  );
  if (expected !== b.signature_key) {
    req.log.warn({ order_id: b.order_id }, "signature TIDAK cocok");
    return reply.code(401).send({ ok: false });
  }
  req.log.info(
    { order_id: b.order_id, status: b.transaction_status },
    "webhook valid",
  );
  return { ok: true };
});

app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
