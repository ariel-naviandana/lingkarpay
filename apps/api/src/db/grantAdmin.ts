import { pool } from "./pool.js";

// Memberi atau mencabut peran admin: npm run admin:grant -- email@contoh.id [--revoke]
const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

if (!email) {
  console.error("Pemakaian: npm run admin:grant -- email@contoh.id [--revoke]");
  process.exit(1);
}

pool
  .query("UPDATE users SET role = $2 WHERE email = $1 RETURNING id, name", [email, revoke ? "user" : "admin"])
  .then((r) => {
    if (r.rowCount === 0) {
      console.error(`Pengguna dengan email ${email} tidak ditemukan. Daftar dulu lewat aplikasi.`);
      process.exitCode = 1;
    } else {
      console.log(`${r.rows[0].name} (${email}) sekarang berperan ${revoke ? "user" : "admin"}.`);
    }
  })
  .catch((err) => {
    console.error("gagal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
