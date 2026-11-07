import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";
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
