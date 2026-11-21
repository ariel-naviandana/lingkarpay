import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { Badge, Button, Card, ErrorBox, Loading, Mono, Td, Th } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { dateTime, etherscanTx, orderLabel, paymentMethod, rupiah, shortHash } from "../lib/format";
import type { Circle, CirclePaymentItem, CirclePayoutItem } from "../types";

const FILTERS = ["Semua", "Lunas", "Menunggu rantai", "Gagal atau kedaluwarsa"] as const;
type Filter = (typeof FILTERS)[number];
const match = (f: Filter, s: string) =>
  f === "Semua" ||
  (f === "Lunas" && s === "ANCHORED") ||
  (f === "Menunggu rantai" && (s === "SETTLED" || s === "SETTLED_PENDING_CHAIN")) ||
  (f === "Gagal atau kedaluwarsa" && (s === "FAILED" || s === "EXPIRED"));

interface PaymentHistoryRow extends CirclePaymentItem {
  circle: string;
  circleId: number;
}

interface PayoutHistoryRow extends CirclePayoutItem {
  circle: string;
  recipient: string;
}

async function loadHistory() {
  const { circles } = await api.circles();
  const per = await Promise.all(
    circles.map(async (circle: Circle) => {
      const [detail, h] = await Promise.all([
        api.circle(circle.id).catch(() => null),
        api.payments(circle.id).catch(() => ({ payments: [], payouts: [] })),
      ]);
      const myRef = detail?.members.find((m) => m.isMe)?.memberRef;
      const nameOf = (ref: string) => detail?.members.find((m) => m.memberRef === ref)?.name ?? ref;
      return {
        mine: h.payments.filter((p) => !myRef || p.memberRef === myRef).map((p) => ({ ...p, circle: circle.name, circleId: circle.id })),
        payouts: h.payouts.map((p) => ({ ...p, circle: circle.name, recipient: nameOf(p.recipientMemberRef) })),
      };
    }),
  );
  const payments = per.flatMap((x) => x.mine).sort((a, b) => +new Date(b.createdAt).getTime() - +new Date(a.createdAt).getTime());
  const payouts = per.flatMap((x) => x.payouts).sort((a, b) => +new Date(b.createdAt).getTime() - +new Date(a.createdAt).getTime());
  return { payments, payouts };
}

const payoutLabel = { SIMULATED: "Disimulasikan", QUEUED: "Dalam antrean", APPROVED: "Disetujui", COMPLETED: "Selesai", FAILED: "Gagal" } as const;
const ORDER_ERR: Record<string, string> = {
  NOT_CANCELLABLE: "Order ini tidak bisa dibatalkan lagi (bukan PENDING, atau gateway menolak).",
  NOT_EXPIRABLE: "Order ini tidak bisa dikedaluwarsakan lagi (bukan PENDING, atau gateway menolak).",
  NO_GATEWAY_TRANSACTION: "Metode bayar belum dipilih di Snap, jadi belum ada transaksi di gateway. Tunggu sampai kedaluwarsa sendiri.",
};

export default function HistoryPage() {
  const [filter, setFilter] = useState<Filter>("Semua");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { data, error, loading, reload } = useAsync(loadHistory, []);

  async function syncAction(orderId: string) {
    setBusy(orderId);
    setNotice(null);
    try {
      const res = await api.order(orderId, true);
      if (res.status === "SETTLED" || res.status === "SETTLED_PENDING_CHAIN" || res.status === "ANCHORED") {
        setNotice({ ok: true, text: `Order ${orderId} terverifikasi lunas di Midtrans.` });
      } else {
        setNotice({ ok: false, text: `Status order ${orderId} di Midtrans: ${res.status}.` });
      }
      reload();
    } catch (e: unknown) {
      setNotice({
        ok: false,
        text: e instanceof Error ? e.message : "Gagal menyinkronkan status",
      });
    } finally {
      setBusy(null);
    }
  }

  async function orderAction(orderId: string, kind: "cancel" | "expire") {
    const verb = kind === "cancel" ? "Batalkan" : "Kedaluwarsakan";
    if (!confirm(`${verb} order ${orderId}? Setelah itu Anda bisa membayar ulang.`)) return;
    setBusy(orderId);
    setNotice(null);
    try {
      await (kind === "cancel" ? api.cancelOrder(orderId) : api.expireOrder(orderId));
      setNotice({ ok: true, text: `Order ${orderId} ${kind === "cancel" ? "dibatalkan" : "dikedaluwarsakan"}. Anda bisa membayar lagi.` });
      reload();
    } catch (e: unknown) {
      const serverDown = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      setNotice({
        ok: false,
        text: serverDown
          ? "Server tidak dapat dihubungi saat ini. Pastikan backend API sudah berjalan."
          : e instanceof ApiError
          ? ORDER_ERR[e.code] ?? e.message
          : e instanceof Error
          ? e.message
          : "Gagal",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;

  const rows = data.payments.filter((p: PaymentHistoryRow) => match(filter, p.status));
  const last = data.payouts[0];
  const steps: readonly (readonly [string, string, boolean])[] = last
    ? [
        ["Iuran terkumpul", "Periode ditutup dengan dana yang terkumpul", true],
        ["Periode siap cair", "Penerima sesuai urutan terkunci", true],
        [
          "Pencairan ke rekening penerima",
          last.mode === "simulated" || last.mode === "SIMULATED" ? "Disimulasikan di sandbox payout" : "Dikirim lewat Midtrans Iris (sandbox)",
          last.status !== "FAILED",
        ],
        ["Dicatat di smart contract", "markPayout dengan hash referensi pencairan. Cocokkan di portal verifikasi publik.", false],
      ]
    : [];

  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Riwayat</h1>
        <p className="text-xs sm:text-sm text-stone-500">Pembayaran Anda dan status pencairan di semua kelompok.</p>
      </header>

      <Card className="overflow-x-auto">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-extrabold">Riwayat pembayaran</h2>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                  filter === f ? "border-brand bg-brand text-white" : "border-sand bg-white text-stone-600 hover:bg-cream"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <p className={`mb-3 rounded-xl px-4 py-3 text-xs sm:text-sm ${notice.ok ? "bg-mint text-brand" : "bg-red-50 text-red-800"}`}>{notice.text}</p>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-stone-500">Belum ada pembayaran{filter !== "Semua" ? " dengan status ini" : ""}. Bayar iuran dari halaman kelompok.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>{["Tanggal", "Kelompok · periode", "Jumlah", "Metode", "Status", "Bukti on-chain", "Aksi"].map((h) => <Th key={h}>{h}</Th>)}</tr>
            </thead>
            <tbody>
              {rows.map((p: PaymentHistoryRow) => {
                const [label, tone] = orderLabel(p.status);
                return (
                  <tr key={p.orderId}>
                    <Td className="whitespace-nowrap">{dateTime(p.paidAt ?? p.createdAt)}</Td>
                    <Td>
                      <Link to={`/groups/${p.circleId}`} className="font-bold hover:underline">{p.circle}</Link>
                      <div className="text-xs text-stone-500">Periode {p.periodNo}</div>
                    </Td>
                    <Td>
                      <b>{rupiah(p.grossAmount)}</b>
                      <div className="text-xs text-stone-500">iuran{p.penaltyAmount > 0 ? " + penalti" : ""} + admin</div>
                    </Td>
                    <Td>{paymentMethod(p.paymentType)}</Td>
                    <Td><Badge tone={tone}>{label}</Badge></Td>
                    <Td>
                      {p.txHash ? (
                        <a href={etherscanTx(p.txHash)} target="_blank" rel="noreferrer" className="underline"><Mono>{shortHash(p.txHash)}</Mono></a>
                      ) : (
                        <Mono>{p.chainStatus ?? "–"}</Mono>
                      )}
                    </Td>
                    <Td>
                      {p.status === "PENDING" ? (
                        <div className="flex gap-1.5">
                          <Button variant="outline" className="!px-2.5 !py-1.5 text-xs text-brand border-brand hover:bg-brand/10" disabled={busy === p.orderId} onClick={() => void syncAction(p.orderId)}>
                            {busy === p.orderId ? "Memeriksa..." : "Sinkronkan"}
                          </Button>
                          <Button variant="outline" className="!px-2.5 !py-1.5 text-xs" disabled={busy === p.orderId} onClick={() => void orderAction(p.orderId, "cancel")}>Batalkan</Button>
                          <Button variant="outline" className="!px-2.5 !py-1.5 text-xs" disabled={busy === p.orderId} onClick={() => void orderAction(p.orderId, "expire")}>Kedaluwarsakan</Button>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">–</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-x-auto">
          <h2 className="mb-2 text-lg sm:text-xl font-extrabold">Status pencairan</h2>
          {data.payouts.length === 0 ? (
            <p className="py-4 text-sm text-stone-500">Belum ada pencairan. Pencairan muncul setelah sebuah periode siap cair.</p>
          ) : (
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr>{["Kelompok · periode", "Penerima", "Jumlah", "Status"].map((h) => <Th key={h}>{h}</Th>)}</tr>
              </thead>
              <tbody>
                {data.payouts.map((p: PayoutHistoryRow) => (
                  <tr key={p.id}>
                    <Td><b>{p.circle}</b><div className="text-xs text-stone-500">Periode {p.periodNo}</div></Td>
                    <Td>{p.recipient}</Td>
                    <Td><b>{rupiah(p.amount)}</b></Td>
                    <Td>
                      <Badge tone={p.status === "FAILED" ? "red" : p.status === "COMPLETED" ? "green" : "purple"}>
                        {payoutLabel[p.status as keyof typeof payoutLabel] ?? p.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {last && steps.length > 0 && (
          <Card className="space-y-4 text-sm">
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold">{last.circle} · Periode {last.periodNo}</h2>
              <p className="text-xs sm:text-sm text-stone-500">
                Pencairan ke {last.recipient} ({last.mode === "simulated" || last.mode === "SIMULATED" ? "simulasi sandbox" : "Iris sandbox"})
              </p>
            </div>
            <div className="space-y-3">
              {steps.map(([t, d, done], i) => (
                <div key={t} className="flex gap-3">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-brand text-white" : "border-2 border-violet-800 text-violet-800"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <div>
                    <b className="text-xs sm:text-sm block">{t}</b>
                    <p className="text-xs text-stone-500">{d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-cream p-3 sm:p-4 text-xs text-stone-600">
              Hash referensi pencairan disimpan di contract, bukan nomor rekeningnya.
              <div className="mt-1 break-all"><Mono>payoutRefHash: {shortHash(last.payoutRefHash)}</Mono></div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
