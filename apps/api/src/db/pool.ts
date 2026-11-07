import pg from "pg";
import { config } from "../config.js";

// BIGINT (rupiah) dikembalikan sebagai number. Aman karena jauh di bawah 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
});

/** Pool atau client transaksi. Fungsi data menerima keduanya. */
export type Db = pg.Pool | pg.PoolClient;

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Kode error Postgres untuk pelanggaran unique. */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
