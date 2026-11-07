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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      // Jangan pernah mencatat header otorisasi.
      redact: ["req.headers.authorization"],
    },
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.setErrorHandler((error, req, reply) => {
    const err: unknown = error;
    if (err instanceof AppError) {
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
  await app.register(authRoutes);
  await app.register(circleRoutes);
  await app.register(checkoutRoutes);
  await app.register(payoutRoutes);
  await app.register(statusRoutes);
  await app.register(webhookRoutes);
  if (config.DEV_TOOLS && config.NODE_ENV !== "production") {
    await app.register(devRoutes);
  }
  return app;
}
