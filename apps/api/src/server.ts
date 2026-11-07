import "dotenv/config";
import dns from "node:dns";
import Fastify from "fastify";
import { verifySignature } from "./lib/signature.js";

// Node di Windows sering memilih IPv6 dulu lalu timeout.
dns.setDefaultResultOrder("ipv4first");

const app = Fastify({ logger: true });
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY!;
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY!;
const SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const STATUS_URL = "https://api.sandbox.midtrans.com/v2";

const basicAuth = () =>
  "Basic " + Buffer.from(SERVER_KEY + ":").toString("base64");

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
      Authorization: basicAuth(),
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.trunc(amount),
      },
      customer_details: { email },
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    req.log.error({ status: res.status, data }, "midtrans error");
    return reply.code(502).send(data);
  }
  return { token: data.token, redirect_url: data.redirect_url };
});

// Webhook (dipakai di Spike B)
app.post("/midtrans-webhook", async (req, reply) => {
  const b = (req.body ?? {}) as any;
  const valid = verifySignature(b, SERVER_KEY);
  req.log.info(
    {
      order_id: b.order_id,
      status_code: b.status_code,
      gross_amount: b.gross_amount,
      gross_amount_type: typeof b.gross_amount,
      status: b.transaction_status,
      signature_valid: valid,
    },
    "webhook DITERIMA",
  );
  if (!valid) {
    req.log.warn({ order_id: b.order_id }, "signature TIDAK cocok");
    return reply.code(401).send({ ok: false });
  }
  req.log.info(
    { order_id: b.order_id, status: b.transaction_status },
    "webhook valid",
  );
  return { ok: true };
});

// Cek status transaksi ke Status API Midtrans + bukti rumus signature benar
app.get("/status/:orderId", async (req, reply) => {
  const { orderId } = req.params as { orderId: string };
  const res = await fetch(`${STATUS_URL}/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: "application/json", Authorization: basicAuth() },
  });
  const d = (await res.json()) as any;
  if (!res.ok) {
    return reply.code(502).send({ gatewayHttpStatus: res.status, data: d });
  }
  return {
    orderId: d.order_id ?? orderId,
    statusCode: d.status_code,
    transactionStatus: d.transaction_status,
    fraudStatus: d.fraud_status,
    paymentType: d.payment_type,
    grossAmount: d.gross_amount,
    // true = rumus SHA512(order_id+status_code+gross_amount+ServerKey) cocok
    signatureValid: verifySignature(d, SERVER_KEY),
  };
});

app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
