import { pool } from "./pool.js";
import { runMigrations } from "./migrations.js";

runMigrations(pool, console.log)
  .then((n) => console.log(n === 0 ? "tidak ada migrasi baru" : `${n} migrasi diterapkan`))
  .catch((err) => {
    console.error("migrasi gagal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
