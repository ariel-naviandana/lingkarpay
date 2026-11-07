import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { login, register } from "../services/auth.js";

const registerBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});
const loginBody = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const b = registerBody.parse(req.body);
    const result = await register(b.name, b.email, b.password);
    return reply.code(201).send(result);
  });

  app.post("/auth/login", async (req) => {
    const b = loginBody.parse(req.body);
    return login(b.email, b.password);
  });

  app.get("/auth/me", async (req) => ({ user: await requireUser(req) }));
}
