import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { createSnapTransaction, ENABLED_PAYMENTS } from "../services/midtrans.js";

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
