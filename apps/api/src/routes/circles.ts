import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../lib/auth.js";
import {
  addMemberByEmail,
  circlePayments,
  createCircle,
  getCircleDetail,
  listCircles,
  listPeriods,
  startCircle,
} from "../services/circles.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  contributionAmount: z.number().int().min(1000),
  memberCount: z.number().int().min(2).max(50),
  periodDays: z.number().int().min(1).max(365),
  penaltyPct: z.number().int().min(0).max(100).default(0),
  adminFee: z.number().int().min(0).default(config.DEFAULT_ADMIN_FEE),
});
const addMemberBody = z.object({ email: z.string().trim().email() });
const startBody = z.object({ order: z.array(z.number().int().positive()).optional() });

export async function circleRoutes(app: FastifyInstance) {
  app.post("/circles", async (req, reply) => {
    const user = await requireUser(req);
    const circle = await createCircle(user.id, createBody.parse(req.body));
    return reply.code(201).send(circle);
  });

  app.get("/circles", async (req) => {
    const user = await requireUser(req);
    return { circles: await listCircles(user.id) };
  });

  app.get("/circles/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return getCircleDetail(user.id, id);
  });

  app.post("/circles/:id/members", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { email } = addMemberBody.parse(req.body);
    return reply.code(201).send(await addMemberByEmail(user.id, id, email));
  });

  app.post("/circles/:id/start", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { order } = startBody.parse(req.body ?? {});
    return startCircle(user.id, id, order);
  });

  app.get("/circles/:id/periods", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { periods: await listPeriods(user.id, id) };
  });

  app.get("/circles/:id/payments", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return circlePayments(user.id, id);
  });
}
