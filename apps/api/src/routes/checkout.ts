import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../lib/auth.js";
import { createCheckout } from "../services/checkout.js";
import { syncOrderFromGateway } from "../services/gatewayStatus.js";
import { cancelOrder, expireOrder, getOrderForUser } from "../services/orders.js";

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

  // ?sync=true: tanya Status API Midtrans lebih dulu (pemulihan bila webhook terlambat/hilang).
  app.get("/orders/:orderId", async (req) => {
    const user = await requireUser(req);
    const { orderId } = z.object({ orderId: z.string().min(1).max(60) }).parse(req.params);
    const { sync } = z
      .object({ sync: z.enum(["true", "false"]).optional() })
      .parse(req.query);

    let order = await getOrderForUser(user, orderId); // sekaligus cek kepemilikan
    if (sync === "true" && order.status === "PENDING") {
      const gatewaySync = await syncOrderFromGateway(orderId);
      order = await getOrderForUser(user, orderId);
      return { ...order, gatewaySync };
    }
    return order;
  });

  // Batalkan pembayaran yang belum dibayar (order PENDING dengan transaksi di Midtrans).
  app.post("/orders/:orderId/cancel", async (req) => {
    const user = await requireUser(req);
    const { orderId } = z.object({ orderId: z.string().min(1).max(60) }).parse(req.params);
    return cancelOrder(user, orderId);
  });

  // Kedaluwarsakan sekarang order PENDING (Expire API Midtrans). Hasil: EXPIRED.
  app.post("/orders/:orderId/expire", async (req) => {
    const user = await requireUser(req);
    const { orderId } = z.object({ orderId: z.string().min(1).max(60) }).parse(req.params);
    return expireOrder(user, orderId);
  });
}
