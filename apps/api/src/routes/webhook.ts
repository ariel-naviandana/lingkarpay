import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { verifySignature } from "../lib/signature.js";

// Versi awal (spike B). Diganti penanganan penuh di langkah 9.
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/midtrans-webhook", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const valid = verifySignature(b, config.MIDTRANS_SERVER_KEY);
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
    return { ok: true };
  });
}
