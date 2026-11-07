import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../lib/auth.js";
import { createCheckout } from "../services/checkout.js";
import { getOrderForUser } from "../services/orders.js";

const checkoutBody = z.object({
  circleId: z.number().int().positive(),
  periodId: z.number().int().positive(),
  memberId: z.number().int().positive(),
});

export async function checkoutRoutes(app: FastifyInstance) {
  // Konfigurasi publik untuk frontend (Client Key memang publik; Server Key tidak pernah keluar).
  app.get("/public-config", async () => ({
    environment: "sandbox",
    midtransClientKey: config.MIDTRANS_CLIENT_KEY,
    snapJsUrl: "https://app.sandbox.midtrans.com/snap/snap.js",
  }));

  app.post("/checkout", async (req, reply) => {
    const user = await requireUser(req);
    const result = await createCheckout(user, checkoutBody.parse(req.body));
    return reply.code(result.reused ? 200 : 201).send(result);
  });

  app.get("/orders/:orderId", async (req) => {
    const user = await requireUser(req);
    const { orderId } = z.object({ orderId: z.string().min(1).max(60) }).parse(req.params);
    return getOrderForUser(user, orderId);
  });
}
