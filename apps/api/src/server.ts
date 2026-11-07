import dns from "node:dns";
import { config } from "./config.js";
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
