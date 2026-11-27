import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { AppError, tooManyRequests } from "../lib/errors.js";
import { FixedWindowLimiter, type RateLimitRule } from "../lib/rateLimit.js";
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

/** Batas laju untuk login (per IP + email, hanya percobaan gagal) dan registrasi (per IP). */
export interface AuthRateLimit {
  login: RateLimitRule;
  register: RateLimitRule;
}

export interface AuthRoutesOptions {
  rateLimit?: AuthRateLimit | false;
}

function guard(limiter: FixedWindowLimiter | null, key: string): void {
  if (!limiter) return;
  const wait = limiter.blockedFor(key);
  if (wait > 0) throw tooManyRequests(wait);
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const loginLimiter = opts.rateLimit ? new FixedWindowLimiter(opts.rateLimit.login) : null;
  const registerLimiter = opts.rateLimit ? new FixedWindowLimiter(opts.rateLimit.register) : null;

  app.post("/auth/register", async (req, reply) => {
    guard(registerLimiter, req.ip);
    registerLimiter?.hit(req.ip);
    const b = registerBody.parse(req.body);
    const result = await register(b.name, b.email, b.password);
    return reply.code(201).send(result);
  });

  app.post("/auth/login", async (req) => {
    const b = loginBody.parse(req.body);
    const key = `${req.ip}|${b.email.toLowerCase()}`;
    guard(loginLimiter, key);
    try {
      const result = await login(b.email, b.password);
      loginLimiter?.reset(key);
      return result;
    } catch (err) {
      if (err instanceof AppError && err.httpStatus === 401) loginLimiter?.hit(key);
      throw err;
    }
  });

  app.get("/auth/me", async (req) => ({ user: await requireUser(req) }));
}
