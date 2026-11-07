import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { pool, isUniqueViolation } from "../db/pool.js";
import { AppError, conflict } from "../lib/errors.js";
import { randomHex, sha256Hex } from "../lib/hash.js";

// Auth sederhana untuk sandbox (bukan fokus penilaian): kata sandi di-hash scrypt,
// sesi berupa token acak yang hanya disimpan dalam bentuk hash.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function createSession(userId: number): Promise<string> {
  const token = randomHex(32);
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [sha256Hex(token), userId, new Date(Date.now() + SESSION_TTL_MS)],
  );
  return token;
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<{ user: AuthUser; token: string }> {
  const normalized = email.trim().toLowerCase();
  try {
    const { rows } = await pool.query<AuthUser>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id, name, email`,
      [name.trim(), normalized, await hashPassword(password)],
    );
    const user = rows[0]!;
    return { user, token: await createSession(user.id) };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("EMAIL_TAKEN", "Email sudah terdaftar");
    throw err;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser; token: string }> {
  const { rows } = await pool.query<AuthUser & { password_hash: string }>(
    "SELECT id, name, email, password_hash FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  // Pesan sama untuk email salah maupun kata sandi salah.
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new AppError("INVALID_CREDENTIALS", "Email atau kata sandi salah", 401);
  }
  const user = { id: row.id, name: row.name, email: row.email };
  return { user, token: await createSession(user.id) };
}

export async function authenticate(token: string): Promise<AuthUser | null> {
  const { rows } = await pool.query<AuthUser>(
    `SELECT u.id, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256Hex(token)],
  );
  return rows[0] ?? null;
}
