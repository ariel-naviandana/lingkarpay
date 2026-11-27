import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { AppError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { statusRoutes } from "./routes/status.js";
import { webhookRoutes } from "./routes/webhook.js";
import { devRoutes } from "./routes/dev.js";
import { authRoutes } from "./routes/auth.js";
import { circleRoutes } from "./routes/circles.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { payoutRoutes } from "./routes/payouts.js";
import { reportRoutes } from "./routes/reports.js";
import { proposalRoutes } from "./routes/proposals.js";
import { adminRoutes } from "./routes/admin.js";
import type { AuthRateLimit } from "./routes/auth.js";

export interface BuildAppOptions {
  /** Batas laju login dan registrasi. Bawaan dari .env; dimatikan saat NODE_ENV=test kecuali diisi. */
  authRateLimit?: AuthRateLimit | false;
}

/** Batas laju bawaan dari konfigurasi. */
function defaultAuthRateLimit(): AuthRateLimit | false {
  if (config.NODE_ENV === "test") return false;
  const windowMs = config.AUTH_RATE_WINDOW_MINUTES * 60_000;
  return {
    login: { max: config.AUTH_LOGIN_MAX_ATTEMPTS, windowMs },
    register: { max: config.AUTH_REGISTER_MAX, windowMs },
  };
}

/**
 * Header keamanan untuk semua respons. API hanya mengembalikan JSON, jadi kebijakan konten
 * dibuat ketat. Tidak ada header CORS: frontend memanggil API lewat proxy Vite (asal yang sama),
 * sehingga browser menolak panggilan dari situs lain.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
};

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      // Jangan pernah mencatat header otorisasi.
      redact: ["req.headers.authorization"],
    },
  });

  // Terima body kosong pada Content-Type JSON (mis. POST aksi tanpa data) sebagai {}.
  // Bawaan Fastify menolaknya dengan 400. Kunci berbahaya "__proto__" dibuang saat parsing.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(text, (key, value) => (key === "__proto__" ? undefined : value)));
    } catch {
      done(Object.assign(new Error("Body JSON tidak valid"), { statusCode: 400 }), undefined);
    }
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.setErrorHandler((error, req, reply) => {
    const err: unknown = error;
    if (err instanceof AppError) {
      if (err.headers) reply.headers(err.headers);
      return reply
        .code(err.httpStatus)
        .send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Input tidak valid",
          details: err.issues,
        },
      });
    }
    const status =
      typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? ((err as { statusCode: number }).statusCode)
        : 500;
    if (status >= 500) {
      req.log.error({ err }, "kesalahan tak tertangani");
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server" },
      });
    }
    return reply.code(status).send({
      error: { code: "BAD_REQUEST", message: (err as Error).message },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { rateLimit: opts.authRateLimit ?? defaultAuthRateLimit() });
  await app.register(circleRoutes);
  await app.register(checkoutRoutes);
  await app.register(payoutRoutes);
  await app.register(reportRoutes);
  await app.register(proposalRoutes);
  await app.register(adminRoutes);
  await app.register(statusRoutes);
  await app.register(webhookRoutes);
  if (config.DEV_TOOLS && config.NODE_ENV !== "production") {
    await app.register(devRoutes);
  }
  return app;
}
