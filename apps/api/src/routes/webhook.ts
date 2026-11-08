import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handleNotification } from "../services/webhook.js";

// Notification URL di dashboard Midtrans menunjuk ke sini.
export async function webhookRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const result = await handleNotification(body, req.log);
    return reply
      .code(result.httpStatus)
      .send({ ok: result.httpStatus < 300, outcome: result.outcome });
  };

  app.post("/midtrans-webhook", handler);
  // Alias: dashboard Midtrans kadang menyimpan Notification URL tanpa path (hanya domain tunnel).
  // Keamanan tetap sama: signature diverifikasi di handleNotification.
  app.post("/", handler);
}
