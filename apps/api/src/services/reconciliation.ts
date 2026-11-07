import { pool } from "../db/pool.js";
import { forbidden, notFound } from "../lib/errors.js";
import { parseRupiah } from "../lib/money.js";
import type { AuthUser } from "./auth.js";
import { getTransactionStatus } from "./midtrans.js";
import { isPaid, mapGatewayStatus, type OrderStatus } from "./orderStatus.js";

/** Pemeriksaan live ke Status API dibatasi agar laporan tetap cepat. */
const LIVE_LIMIT = 50;

/** Flag yang hanya informasi (bukan masalah). */
const INFO_FLAGS = new Set(["CHAIN_PENDING"]);

interface OrderLine {
  id: number;
  order_id: string;
  status: OrderStatus;
  amount: number;
  penalty_amount: number;
  admin_fee: number;
  gross_amount: number;
  gateway_ref: string | null;
  paid_at: Date | null;
  period_no: number;
  member_ref: string;
  job_status: string | null;
  job_attempts: number | null;
  tx_hash: string | null;
}

/**
 * Laporan rekonsiliasi satu kelompok: mencocokkan pesanan (database), status gateway,
 * dan pencatatan on-chain. Hanya untuk pembuat kelompok (operator).
 * live=true menambah pemeriksaan ke Status API Midtrans (maksimal 50 order terbaru).
 */
export async function reconcileCircle(user: AuthUser, circleId: number, live: boolean) {
  const circle = await pool.query<{ created_by: number; name: string }>(
    "SELECT created_by, name FROM circles WHERE id = $1",
    [circleId],
  );
  if (!circle.rows[0]) throw notFound("Kelompok");
  if (circle.rows[0].created_by !== user.id) {
    throw forbidden("Laporan rekonsiliasi hanya untuk pembuat kelompok (operator)");
  }

  const lines = (
    await pool.query<OrderLine>(
      `SELECT o.id, o.order_id, o.status, o.amount, o.penalty_amount, o.admin_fee, o.gross_amount,
              o.gateway_ref, o.paid_at, p.period_no, m.member_ref,
              j.status AS job_status, j.attempts AS job_attempts, t.tx_hash
         FROM orders o
         JOIN periods p ON p.id = o.period_id
         JOIN members m ON m.id = o.member_id
         LEFT JOIN chain_jobs j ON j.order_id = o.id AND j.kind = 'recordPayment'
         LEFT JOIN LATERAL (
              SELECT tx_hash FROM chain_transactions
               WHERE job_id = j.id AND status = 'confirmed'
               ORDER BY id DESC LIMIT 1) t ON TRUE
        WHERE p.circle_id = $1
        ORDER BY o.created_at DESC`,
      [circleId],
    )
  ).rows;

  const orders = [];
  let liveChecked = 0;
  for (const o of lines) {
    const flags: string[] = [];

    // Database ↔ chain
    if (isPaid(o.status) && o.job_status === null) flags.push("PAID_WITHOUT_CHAIN_JOB");
    if (o.status === "ANCHORED" && !o.tx_hash) flags.push("ANCHORED_WITHOUT_TX");
    if (o.job_status === "confirmed" && o.status !== "ANCHORED") flags.push("CHAIN_CONFIRMED_ORDER_NOT_ANCHORED");
    if (o.job_status === "failed") flags.push("CHAIN_FAILED");
    if ((o.status === "SETTLED" || o.status === "SETTLED_PENDING_CHAIN") &&
        (o.job_status === "queued" || o.job_status === "sent")) {
      flags.push("CHAIN_PENDING");
    }

    // Database ↔ gateway (opsional, live)
    let gatewayStatus: string | null | undefined;
    if (live && liveChecked < LIVE_LIMIT) {
      liveChecked++;
      try {
        const g = await getTransactionStatus(o.order_id);
        if (!g.found) {
          gatewayStatus = null;
          if (isPaid(o.status)) flags.push("GATEWAY_NOT_FOUND");
        } else if (!g.signatureValid) {
          gatewayStatus = String(g.data.transaction_status);
          flags.push("GATEWAY_SIGNATURE_INVALID");
        } else {
          gatewayStatus = String(g.data.transaction_status);
          const target = mapGatewayStatus(g.data.transaction_status, g.data.fraud_status);
          if (parseRupiah(g.data.gross_amount) !== o.gross_amount) flags.push("GATEWAY_AMOUNT_MISMATCH");
          if (target === "SETTLED" && !isPaid(o.status)) flags.push("GATEWAY_PAID_DB_NOT");
          else if (isPaid(o.status) && target && target !== "SETTLED") flags.push("DB_PAID_GATEWAY_NOT");
          else if ((target === "FAILED" || target === "EXPIRED") && o.status === "PENDING") {
            flags.push("GATEWAY_CLOSED_DB_PENDING");
          }
        }
      } catch {
        flags.push("GATEWAY_CHECK_FAILED");
      }
    }

    orders.push({
      orderId: o.order_id,
      periodNo: o.period_no,
      memberRef: o.member_ref,
      status: o.status,
      grossAmount: o.gross_amount,
      gatewayRef: o.gateway_ref,
      paidAt: o.paid_at,
      chainJob: o.job_status ? { status: o.job_status, attempts: o.job_attempts } : null,
      txHash: o.tx_hash,
      ...(gatewayStatus !== undefined ? { gatewayStatus } : {}),
      flags,
    });
  }

  // Ringkasan keuangan (hanya order yang sudah dibayar)
  const paid = lines.filter((o) => isPaid(o.status));
  const byStatus: Record<string, number> = {};
  for (const o of lines) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const collectedByPeriod = new Map<number, number>();
  for (const o of paid) {
    collectedByPeriod.set(o.period_no, (collectedByPeriod.get(o.period_no) ?? 0) + o.amount + o.penalty_amount);
  }
  const payouts = (
    await pool.query<{ period_no: number; amount: number; status: string; mode: string }>(
      `SELECT p.period_no, po.amount, po.status, po.mode
         FROM payouts po JOIN periods p ON p.id = po.period_id
        WHERE p.circle_id = $1 ORDER BY p.period_no`,
      [circleId],
    )
  ).rows;
  const payoutByPeriod = new Map(payouts.map((p) => [p.period_no, p]));
  const periods = [...new Set([...collectedByPeriod.keys(), ...payoutByPeriod.keys()])]
    .sort((a, b) => a - b)
    .map((no) => {
      const collected = collectedByPeriod.get(no) ?? 0;
      const payout = payoutByPeriod.get(no) ?? null;
      return {
        periodNo: no,
        collected,
        payoutAmount: payout ? payout.amount : null,
        payoutStatus: payout ? payout.status : null,
        // Selisih terkumpul − dicairkan. Harus 0 bila periode sudah dicairkan.
        difference: payout ? collected - payout.amount : null,
      };
    });

  const events = (
    await pool.query<{ outcome: string | null; n: number }>(
      `SELECT e.outcome, count(*)::int AS n
         FROM webhook_events e
        WHERE e.order_id IN (SELECT o.order_id FROM orders o
                               JOIN periods p ON p.id = o.period_id
                              WHERE p.circle_id = $1)
        GROUP BY e.outcome`,
      [circleId],
    )
  ).rows;

  const issueOrders = orders.filter((o) => o.flags.some((f) => !INFO_FLAGS.has(f))).length;
  const periodIssues = periods.filter((p) => p.difference !== null && p.difference !== 0).length;

  return {
    circleId,
    circleName: circle.rows[0].name,
    generatedAt: new Date(),
    live,
    summary: {
      ordersByStatus: byStatus,
      grossPaid: paid.reduce((s, o) => s + o.gross_amount, 0),
      adminFeeRevenue: paid.reduce((s, o) => s + o.admin_fee, 0),
      collectedForPayout: paid.reduce((s, o) => s + o.amount + o.penalty_amount, 0),
      payoutTotal: payouts.reduce((s, p) => s + p.amount, 0),
      webhookEventsByOutcome: Object.fromEntries(events.map((e) => [e.outcome ?? "unprocessed", e.n])),
      issues: issueOrders + periodIssues,
      liveChecked,
    },
    periods,
    orders,
  };
}
