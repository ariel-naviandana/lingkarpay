import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Mono, Td, Th } from "../components/ui";
import { api } from "../api";
import { formatDateTime, rupiah, shortenHash } from "../lib/format";
import { mockPayments, mockPayouts } from "../lib/mock";
import type { CirclePaymentItem, CirclePayoutItem } from "../types";

type FilterType = "Semua" | "Lunas" | "Menunggu rantai" | "Gagal atau kedaluwarsa";

interface PaymentRow extends CirclePaymentItem {
  circleName: string;
}

interface PayoutRow extends CirclePayoutItem {
  circleName: string;
}

export default function HistoryPage() {
  const [filter, setFilter] = useState<FilterType>("Semua");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const circleRes = await api.circles();
      const circleList = circleRes.circles || [];

      const allPayments: PaymentRow[] = [];
      const allPayouts: PayoutRow[] = [];

      await Promise.all(
        circleList.map(async (c) => {
          try {
            const payRes = await api.payments(c.id);
            if (payRes.payments) {
              for (const p of payRes.payments) {
                allPayments.push({ ...p, circleName: c.name });
              }
            }
            if (payRes.payouts) {
              for (const po of payRes.payouts) {
                allPayouts.push({ ...po, circleName: c.name });
              }
            }
          } catch {
            // Circle payments might fail or not exist
          }
        })
      );

      // Sort newest first
      allPayments.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      allPayouts.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      // If no payments from API or offline, fallback to mock data
      if (allPayments.length === 0) {
        for (const p of mockPayments) {
          allPayments.push({ ...p, circleName: "Arisan Kantor DPE" });
        }
      }
      if (allPayouts.length === 0) {
        for (const po of mockPayouts) {
          allPayouts.push({ ...po, circleName: "Arisan Kantor DPE" });
        }
      }

      setPayments(allPayments);
      setPayouts(allPayouts);
    } catch {
      // Fallback
      setPayments(mockPayments.map((p) => ({ ...p, circleName: "Arisan Kantor DPE" })));
      setPayouts(mockPayouts.map((po) => ({ ...po, circleName: "Arisan Kantor DPE" })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredPayments = payments.filter((p) => {
    if (filter === "Semua") return true;
    if (filter === "Lunas") {
      return p.status === "SETTLED" || p.status === "ANCHORED";
    }
    if (filter === "Menunggu rantai") {
      return p.status === "SETTLED_PENDING_CHAIN";
    }
    if (filter === "Gagal atau kedaluwarsa") {
      return p.status === "FAILED" || p.status === "EXPIRED";
    }
    return true;
  });

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Riwayat</h1>
          <p className="text-xs sm:text-sm text-stone-500">
            Pembayaran iuran dan status pencairan di semua kelompok arisan Anda.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void loadHistory()}
          disabled={loading}
          className="text-xs w-full sm:w-auto"
        >
          {loading ? "Menyegarkan..." : "↻ Segarkan"}
        </Button>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" onClick={() => void loadHistory()} className="text-xs !py-1">
            Coba lagi
          </Button>
        </div>
      )}

      {/* Riwayat Pembayaran Card */}
      <Card className="overflow-x-auto">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-extrabold">Riwayat pembayaran iuran</h2>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {(["Semua", "Lunas", "Menunggu rantai", "Gagal atau kedaluwarsa"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition ${
                  filter === f
                    ? "border-brand bg-brand text-white"
                    : "border-sand bg-white text-stone-600 hover:bg-cream"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <p className="py-6 text-center text-xs sm:text-sm text-stone-500">
            {loading ? "Memuat riwayat pembayaran..." : "Tidak ada transaksi dalam kategori ini."}
          </p>
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr>
                {["Tanggal", "Kelompok · periode", "Jumlah", "Metode", "Status", "Bukti on-chain"].map(
                  (h) => (
                    <Th key={h}>{h}</Th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((p) => {
                let tone: "green" | "amber" | "red" | "purple" | "gray" = "gray";
                let statusLabel = p.status as string;

                if (p.status === "ANCHORED") {
                  tone = "purple";
                  statusLabel = "Lunas · tercatat";
                } else if (p.status === "SETTLED") {
                  tone = "green";
                  statusLabel = "Lunas";
                } else if (p.status === "SETTLED_PENDING_CHAIN") {
                  tone = "amber";
                  statusLabel = "Lunas · menunggu rantai";
                } else if (p.status === "PENDING") {
                  tone = "amber";
                  statusLabel = "Menunggu bayar";
                } else if (p.status === "FAILED") {
                  tone = "red";
                  statusLabel = "Gagal";
                } else if (p.status === "EXPIRED") {
                  tone = "red";
                  statusLabel = "Kedaluwarsa";
                }

                return (
                  <tr key={p.orderId}>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDateTime(p.paidAt || p.createdAt)}
                    </Td>
                    <Td>
                      <b>{p.circleName}</b>
                      <div className="text-xs text-stone-500">
                        Periode {p.periodNo} · {p.memberName}
                      </div>
                    </Td>
                    <Td>
                      <b>{rupiah(p.grossAmount)}</b>
                      <div className="text-xs text-stone-500">
                        iuran {rupiah(p.amount)}
                        {p.penaltyAmount > 0 && ` + penalti ${rupiah(p.penaltyAmount)}`}
                        {p.adminFee > 0 && ` + admin ${rupiah(p.adminFee)}`}
                      </div>
                    </Td>
                    <Td>
                      <span className="capitalize">{p.paymentType || "–"}</span>
                    </Td>
                    <Td>
                      <Badge tone={tone}>{statusLabel}</Badge>
                    </Td>
                    <Td>
                      {p.txHash ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${p.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          <Mono>{shortenHash(p.txHash, 5)}</Mono>
                        </a>
                      ) : (
                        <span className="text-stone-400">–</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Status Pencairan & Flow */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-x-auto">
          <h2 className="mb-2 text-lg sm:text-xl font-extrabold">Status pencairan (Payouts)</h2>
          {payouts.length === 0 ? (
            <p className="py-6 text-center text-xs sm:text-sm text-stone-500">
              {loading ? "Memuat data pencairan..." : "Belum ada pencairan dana di kelompok Anda."}
            </p>
          ) : (
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr>
                  {["Kelompok · periode", "Penerima", "Jumlah", "Status", "Hash referensi"].map(
                    (h) => (
                      <Th key={h}>{h}</Th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <b>{p.circleName}</b>
                      <div className="text-xs text-stone-500">Periode {p.periodNo}</div>
                    </Td>
                    <Td>
                      <Mono>{p.recipientMemberRef}</Mono>
                    </Td>
                    <Td>
                      <b>{rupiah(p.amount)}</b>
                    </Td>
                    <Td>
                      <Badge tone={p.status === "SIMULATED" || p.status === "APPROVED" ? "green" : "purple"}>
                        {p.status}
                      </Badge>
                    </Td>
                    <Td>
                      <Mono>{shortenHash(p.payoutRefHash, 4)}</Mono>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="space-y-4 text-sm">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold">Alur pencairan dana</h2>
            <p className="text-xs sm:text-sm text-stone-500">
              Prosedur otomatis penegakan smart contract saat periode selesai.
            </p>
          </div>
          <div className="space-y-3">
            {[
              ["1. Iuran periode lengkap", "Semua anggota lunas atau kuorum penutupan tercapai"],
              ["2. Periode siap cair (ready_payout)", "Penerima dikunci sesuai urutan giliran pada contract"],
              ["3. Pencairan dana", "Disalurkan lewat simulasi sandbox atau gateway payout (Iris)"],
              ["4. Dicatat di smart contract", "markPayout dieksekusi dengan hash referensi dan membuka periode berikutnya"],
            ].map(([t, d], i) => (
              <div key={t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <b className="text-xs sm:text-sm block">{t}</b>
                  <p className="text-xs text-stone-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-cream p-3 sm:p-4 text-xs text-stone-600">
            Rekening tujuan dan bukti transfer disimpan sebagai hash kriptografi di contract untuk privasi anggota.
          </div>
        </Card>
      </div>
    </div>
  );
}
