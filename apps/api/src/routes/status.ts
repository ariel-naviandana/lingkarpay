import type { FastifyInstance } from "fastify";
import { getTransactionStatus } from "../services/midtrans.js";

export async function statusRoutes(app: FastifyInstance) {
  // Cek status ke Status API Midtrans + bukti rumus signature benar.
  app.get("/status/:orderId", async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const s = await getTransactionStatus(orderId);
    if (!s.found) {
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Order tidak dikenal Midtrans" },
      });
    }
    return {
      orderId: s.data.order_id ?? orderId,
      statusCode: s.data.status_code,
      transactionStatus: s.data.transaction_status,
      fraudStatus: s.data.fraud_status,
      paymentType: s.data.payment_type,
      grossAmount: s.data.gross_amount,
      signatureValid: s.signatureValid,
    };
  });
}
