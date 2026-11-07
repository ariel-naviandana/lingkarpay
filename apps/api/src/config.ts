import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1, "wajib diisi"),

  MIDTRANS_SERVER_KEY: z.string().min(1, "wajib diisi"),
  MIDTRANS_CLIENT_KEY: z.string().min(1, "wajib diisi"),

  ORDER_EXPIRY_MINUTES: z.coerce.number().int().min(5).default(60),
  DEFAULT_ADMIN_FEE: z.coerce.number().int().min(0).default(1000),

  DEV_TOOLS: bool.default("true"),

  // Midtrans Iris (payout sandbox). Dimatikan secara bawaan; pencairan memakai simulasi.
  IRIS_ENABLED: bool.default("false"),
  IRIS_CREATOR_KEY: z.string().optional(),
  IRIS_APPROVER_KEY: z.string().optional(),
  IRIS_OTP: z.string().default("335163"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    // Hanya nama variabel dan pesan, tidak pernah mencetak nilai.
    throw new Error(`Konfigurasi .env tidak valid:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const config: Config = load();
