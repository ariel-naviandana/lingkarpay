import type { FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "./errors.js";
import { authenticate, type AuthUser } from "../services/auth.js";

/** Membaca "Authorization: Bearer <token>" dan mengembalikan user, atau 401. */
export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (!match || !match[1]) throw unauthorized();
  const user = await authenticate(match[1].trim());
  if (!user) throw unauthorized("Sesi tidak valid atau sudah kedaluwarsa");
  return user;
}

/** Seperti requireUser, tetapi hanya untuk peran admin (403 bagi yang lain). Peran dibaca dari database, bukan dari klien. */
export async function requireAdmin(req: FastifyRequest): Promise<AuthUser> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw forbidden("Hanya untuk admin platform");
  return user;
}
