import dns from "node:dns";
import { config, SIGNATURE_KEY } from "./config.js";
import { sha256Hex } from "./lib/hash.js";
import { buildApp } from "./app.js";
import { expireOverdueOrders } from "./services/orders.js";

// Node di Windows sering memilih IPv6 dulu lalu timeout.
dns.setDefaultResultOrder("ipv4first");

const app = await buildApp();

// Jaring pengaman: tutup order PENDING yang jauh melewati batas waktu.
const sweeper = setInterval(() => {
  expireOverdueOrders().catch((err) => app.log.error({ err }, "penyapu order gagal"));
}, 60_000);
sweeper.unref();
app.addHook("onClose", async () => clearInterval(sweeper));

await app.listen({ port: config.PORT, host: "0.0.0.0" });

// Sidik jari (SHA-256, 8 karakter) untuk memastikan key dari .env yang termuat. Bukan key-nya.
app.log.info(
  {
    server_key_fp: sha256Hex(config.MIDTRANS_SERVER_KEY).slice(0, 8),
    signature_key_fp: sha256Hex(SIGNATURE_KEY).slice(0, 8),
    separate_signature_key: config.MIDTRANS_SIGNATURE_KEY !== undefined,
  },
  "key Midtrans dimuat dari .env (sidik jari, bukan key)",
);
