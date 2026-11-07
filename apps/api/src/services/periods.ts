import type { Db } from "../db/pool.js";

/**
 * Cermin sisi backend: periode "running" menjadi "ready_payout" bila semua anggota
 * sudah punya iuran berstatus lunas. Keputusan resmi tetap di smart contract (closePeriod).
 * Mengembalikan true bila status periode baru saja berubah.
 */
export async function refreshPeriodReadiness(db: Db, periodId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE periods p
        SET status = 'ready_payout'
      WHERE p.id = $1
        AND p.status = 'running'
        AND (SELECT count(DISTINCT o.member_id)
               FROM orders o
              WHERE o.period_id = p.id
                AND o.status IN ('SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED'))
          = (SELECT c.member_count FROM circles c WHERE c.id = p.circle_id)`,
    [periodId],
  );
  return (rowCount ?? 0) > 0;
}
