import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { reconcileCircle } from "../services/reconciliation.js";

const query = z.object({
  circleId: z.coerce.number().int().positive(),
  live: z.enum(["true", "false"]).default("false"),
});

export async function reportRoutes(app: FastifyInstance) {
  // GET /reports/reconciliation?circleId=1&live=true
  app.get("/reports/reconciliation", async (req) => {
    const user = await requireUser(req);
    const q = query.parse(req.query);
    return reconcileCircle(user, q.circleId, q.live === "true");
  });
}
