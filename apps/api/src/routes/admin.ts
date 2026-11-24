import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth.js";
import { listAllCircles } from "../services/circles.js";

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/circles: semua kelompok (untuk konsol operator). Hanya admin platform.
  app.get("/admin/circles", async (req) => {
    await requireAdmin(req);
    return { circles: await listAllCircles() };
  });
}
