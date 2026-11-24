import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Mono, Td, Th, Select } from "../../components/ui";
import { api } from "../../api";
import { formatDateTime, rupiah, shortenHash } from "../../lib/format";
import type { AdminCircle, ReconciliationReport } from "../../types";

export default function OperatorPage() {
  const [circles, setCircles] = useState<AdminCircle[]>([]);
  const [selectedCircleId, setSelectedCircleId] = useState<number>(0);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReconciling, setIsReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconNotice, setReconNotice] = useState<string | null>(null);

  const loadCircles = useCallback(async () => {
    try {
      // Admin melihat semua kelompok di platform (peran diperiksa server).
      const res = await api.adminCircles();
      const list = res.circles || [];
      setCircles(list);
      if (list.length > 0) {
        setSelectedCircleId(list[0].id);
      } else {
        setLoading(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal memuat daftar kelompok.");
      setLoading(false);
    }
  }, []);

  const fetchReconciliation = useCallback(async (cId: number, live = false) => {
    if (live) {
      setIsReconciling(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await api.reconciliation(cId, live);
      setReport(data);
      if (live) {
        setReconNotice(
          `Rekonsiliasi live 3 sumber selesai: ${data.orders.length} order diperiksa, ${data.summary.issues} selisih terdeteksi.`
        );
        setTimeout(() => setReconNotice(null), 5000);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memuat laporan rekonsiliasi dari backend. Pastikan server API berjalan."
      );
      setReport(null);
    } finally {
      setLoading(false);
      setIsReconciling(false);
    }
  }, []);

  useEffect(() => {
    void loadCircles();
  }, [loadCircles]);

  useEffect(() => {
    if (selectedCircleId) {
      void fetchReconciliation(selectedCircleId, false);
    }
  }, [selectedCircleId, fetchReconciliation]);

  const handleRunRecon = () => {
    if (selectedCircleId) {
      void fetchReconciliation(selectedCircleId, true);
    }
  };

  const handleExportCSV = () => {
    if (!report) return;
    const csvContent =
      "data:text/csv;charset=utf-8," +
      ["Order ID,Periode,Member Ref,Status DB,Gross Amount,Gateway Ref,Paid At,Tx Hash,Flags"]
        .concat(
          report.orders.map(
            (o) =>
              `"${o.orderId}","P${o.periodNo}","${o.memberRef}","${o.status}","${o.grossAmount}","${o.gatewayRef || ""}","${o.paidAt || ""}","${o.txHash || ""}","${o.flags.join(";")}"`
          )
        )
        .join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `lingkarpay_reconciliation_${report.circleId}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalOrders = report?.orders.length ?? 0;
  const issuesCount = report?.summary.issues ?? 0;
  const synchronizedCount = Math.max(0, totalOrders - issuesCount);
  const webhookOutcomes = report?.summary.webhookEventsByOutcome || {};
  const webhookProcessed = Object.values(webhookOutcomes).reduce((a, b) => a + b, 0);

  const issueOrders = report?.orders.filter((o) => o.flags.length > 0) || [];

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Operator Console</h1>
            <Badge tone="purple">Admin Only</Badge>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-stone-500">
            Log pesanan, rekonsiliasi tiga arah (Database ↔ Gateway ↔ Smart Contract), dan antrean pencatatan on-chain.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {circles.length > 0 && (
            <div className="w-64">
              <Select
                value={selectedCircleId}
                onChange={(e) => setSelectedCircleId(Number(e.target.value))}
              >
                {circles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (ID #{c.id}) · oleh {c.creatorName}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Badge tone="amber">Midtrans sandbox · Sepolia</Badge>
        </div>
      </header>

      {reconNotice && (
        <div className="rounded-xl border border-brand/30 bg-mint/50 px-4 py-3 text-xs sm:text-sm text-brand font-semibold flex items-center justify-between">
          <span>✓ {reconNotice}</span>
          <button onClick={() => setReconNotice(null)} className="text-stone-500 hover:text-ink">✕</button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" onClick={() => void fetchReconciliation(selectedCircleId, false)} className="text-xs">
            Coba lagi
          </Button>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ["Total order kelompok", `${totalOrders}`, "text-brand"],
          ["Sinkron di tiga sumber", `${synchronizedCount}`, "text-brand"],
          ["Selisih terdeteksi", `${issuesCount}`, issuesCount > 0 ? "text-red-800" : "text-stone-600"],
          ["Webhook event", `${webhookProcessed}`, "text-amber-800"],
        ].map(([a, b, c]) => (
          <Card key={a} className="p-3.5 sm:p-5">
            <p className="text-xs sm:text-sm text-stone-500">{a}</p>
            <p className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${c}`}>{b}</p>
          </Card>
        ))}
      </div>

      {/* Orders & Gateway Table */}
      <Card className="overflow-x-auto">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold">Catatan order & status gateway</h2>
            <p className="text-xs text-stone-500">
              Daftar transaksi pesanan untuk kelompok {report?.circleName || `#${selectedCircleId}`}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!report || report.orders.length === 0}
            className="w-full sm:w-auto text-xs sm:text-sm !py-1.5 sm:!py-2"
          >
            Ekspor CSV
          </Button>
        </div>

        {loading && !report ? (
          <p className="py-6 text-center text-xs sm:text-sm text-stone-500">Memuat laporan rekonsiliasi...</p>
        ) : !report || report.orders.length === 0 ? (
          <p className="py-6 text-center text-xs sm:text-sm text-stone-500">Belum ada order pada kelompok ini.</p>
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr>
                {["Order ID", "Periode", "Anggota", "Gross Amount", "Status DB", "Gateway", "Status Chain"].map(
                  (h) => (
                    <Th key={h}>{h}</Th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {report.orders.map((o) => {
                let statusTone: "green" | "amber" | "purple" | "red" | "gray" = "gray";
                if (o.status === "ANCHORED") statusTone = "purple";
                else if (o.status === "SETTLED") statusTone = "green";
                else if (o.status === "SETTLED_PENDING_CHAIN") statusTone = "amber";
                else if (o.status === "FAILED" || o.status === "EXPIRED") statusTone = "red";

                return (
                  <tr key={o.orderId}>
                    <Td>
                      <Mono>{o.orderId}</Mono>
                      {o.paidAt && (
                        <div className="text-[11px] text-stone-400">
                          {formatDateTime(o.paidAt)}
                        </div>
                      )}
                    </Td>
                    <Td>P{o.periodNo}</Td>
                    <Td>
                      <Mono>{o.memberRef}</Mono>
                    </Td>
                    <Td>{rupiah(o.grossAmount)}</Td>
                    <Td>
                      <Badge tone={statusTone}>{o.status}</Badge>
                    </Td>
                    <Td>
                      <span className="text-xs">
                        {o.gatewayRef ? `Ref: ${o.gatewayRef}` : o.gatewayStatus || "–"}
                      </span>
                    </Td>
                    <Td>
                      {o.txHash ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${o.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          <Mono>{shortenHash(o.txHash, 4)}</Mono>
                        </a>
                      ) : (
                        <span className="text-stone-400 text-xs">
                          {o.chainJob ? o.chainJob.status : "–"}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Reconciliation Issues & Outbox Grid */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="space-y-4 text-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold">Rekonsiliasi tiga sumber</h2>
              <p className="text-xs text-stone-500">
                Pemeriksaan silang status database vs Midtrans Status API vs Sepolia.
              </p>
            </div>
            <Button
              disabled={isReconciling || loading}
              onClick={handleRunRecon}
              className="w-full sm:w-auto text-xs sm:text-sm !py-1.5 sm:!py-2"
            >
              {isReconciling ? "Memeriksa Status API..." : "Jalankan live rekonsiliasi"}
            </Button>
          </div>

          <div className="space-y-3">
            {totalOrders === 0 ? (
              <p className="rounded-xl bg-cream p-4 text-center text-xs text-stone-500">
                Belum ada transaksi yang bisa dicocokkan pada kelompok ini.
              </p>
            ) : issueOrders.length === 0 ? (
              <p className="rounded-xl bg-mint/50 p-4 text-center text-xs text-brand font-semibold">
                ✓ Semua transaksi cocok di database, payment gateway, dan smart contract!
              </p>
            ) : (
              issueOrders.map((r) => (
                <div key={r.orderId} className="space-y-1.5 border-t border-sand pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Mono>{r.orderId}</Mono>
                    <Badge tone="red">{r.flags.join(", ")}</Badge>
                  </div>
                  <p className="text-xs sm:text-sm">
                    Status Database: <b>{r.status}</b> · Gateway: <b>{r.gatewayStatus || "–"}</b>
                  </p>
                  <p className="text-xs sm:text-sm">
                    On-chain Job: <b>{r.chainJob ? r.chainJob.status : "Belum ada job"}</b>
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Antrean Outbox Chain Jobs */}
        <Card className="overflow-x-auto">
          <div className="mb-2">
            <h2 className="text-lg sm:text-xl font-extrabold">Antrean pencatatan on-chain (Outbox)</h2>
            <p className="text-xs text-stone-500">
              ID kelompok on-chain:{" "}
              {report?.chain.chainCircleId ? `#${report.chain.chainCircleId}` : "Belum dicatat"}
            </p>
          </div>
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr>
                {["Jenis Job", "Target", "Percobaan", "Status"].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report?.chain.createCircleJob && (
                <tr>
                  <Td><b>createCircle</b></Td>
                  <Td>Kelompok #{report.circleId}</Td>
                  <Td>{report.chain.createCircleJob.attempts}/5</Td>
                  <Td>
                    <Badge
                      tone={
                        report.chain.createCircleJob.status === "confirmed"
                          ? "green"
                          : report.chain.createCircleJob.status === "failed"
                          ? "red"
                          : "amber"
                      }
                    >
                      {report.chain.createCircleJob.status}
                    </Badge>
                  </Td>
                </tr>
              )}
              {report?.orders
                .filter((o) => o.chainJob)
                .slice(0, 5)
                .map((o) => (
                  <tr key={`job-${o.orderId}`}>
                    <Td><b>recordPayment</b></Td>
                    <Td><Mono>{o.orderId}</Mono></Td>
                    <Td>{o.chainJob?.attempts}/5</Td>
                    <Td>
                      <Badge
                        tone={
                          o.chainJob?.status === "confirmed"
                            ? "green"
                            : o.chainJob?.status === "failed"
                            ? "red"
                            : "amber"
                        }
                      >
                        {o.chainJob?.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              {(!report || (!report.chain.createCircleJob && report.orders.filter((o) => o.chainJob).length === 0)) && (
                <tr>
                  <td colSpan={4} className="text-center text-xs text-stone-500 py-4">
                    Tidak ada antrean job on-chain saat ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
