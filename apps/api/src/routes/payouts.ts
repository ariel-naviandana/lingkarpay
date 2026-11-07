import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { createPayout } from "../services/payouts.js";

const simulateBody = z.object({ periodId: z.number().int().positive() });
const irisBody = simulateBody.extend({
  // Data dummy saja (aturan tugas). Nomor rekening tidak disimpan, hanya hash-nya.
  beneficiary: z.object({
    name: z.string().min(1).max(100),
    account: z.string().min(3).max(40),
    bank: z.string().min(2).max(20),
    email: z.string().email(),
  }),
});

export async function payoutRoutes(app: FastifyInstance) {
  // Simulasi pencairan (sandbox): mencatat payout dan mengantrekan markPayout ke modul chain.
  app.post("/payouts/simulate", async (req, reply) => {
    const user = await requireUser(req);
    const b = simulateBody.parse(req.body);
    const payout = await createPayout(user, { periodId: b.periodId, mode: "simulated" });
    return reply.code(201).send(payout);
  });

  // Payout lewat Midtrans Iris sandbox (butuh IRIS_ENABLED dan kunci creator/approver).
  app.post("/payouts/iris", async (req, reply) => {
    const user = await requireUser(req);
    const b = irisBody.parse(req.body);
    const payout = await createPayout(user, {
      periodId: b.periodId,
      mode: "iris",
      beneficiary: b.beneficiary,
    });
    return reply.code(201).send(payout);
  });
}
