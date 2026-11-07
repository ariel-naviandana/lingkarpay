import type { FastifyInstance } from "fastify";
import { handleNotification } from "../services/webhook.js";

// Notification URL di dashboard Midtrans menunjuk ke sini.
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/midtrans-webhook", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const result = await handleNotification(body, req.log);
    return reply
      .code(result.httpStatus)
      .send({ ok: result.httpStatus < 300, outcome: result.outcome });
  });
}
