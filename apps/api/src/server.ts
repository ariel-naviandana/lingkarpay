import dns from "node:dns";
import { config } from "./config.js";
import { buildApp } from "./app.js";

// Node di Windows sering memilih IPv6 dulu lalu timeout.
dns.setDefaultResultOrder("ipv4first");

const app = await buildApp();
await app.listen({ port: config.PORT, host: "0.0.0.0" });
