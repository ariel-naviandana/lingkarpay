import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Logo } from "../components/ui";
import type { OrderStatus } from "../types";

const methods = [
  ["Virtual Account BCA", "Transfer"],
  ["Virtual Account BNI", "Transfer"],
  ["Virtual Account BRI", "Transfer"],
  ["GoPay", "E-wallet"],
  ["ShopeePay", "E-wallet"],
];
const statuses: OrderStatus[] = [
  "PENDING",
  "SETTLED",
  "SETTLED_PENDING_CHAIN",
  "ANCHORED",
  "FAILED",
  "EXPIRED",
];

export default function PaymentPage() {
  const [chosen, setChosen] = useState<string | null>("Virtual Account BCA");
  const [status, setStatus] = useState<OrderStatus>("PENDING");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleSimulatePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setStatus("SETTLED_PENDING_CHAIN");
      setPaymentSuccess(true);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-cream">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sand bg-white px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/groups/1" className="text-xs sm:text-sm font-semibold hover:text-brand transition">
          ‹ Kembali ke kelompok
        </Link>
        <div className="flex items-center gap-3">
          <Logo />
          <Badge tone="amber">Sandbox · tanpa uang nyata</Badge>
        </div>
      </header>

      <div className="w-full grid gap-6 p-4 sm:p-6 lg:p-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Bayar iuran</h1>
            <p className="mt-1 text-xs sm:text-sm text-stone-500">
              Arisan Kantor DPE · Periode 3 · November 2026
            </p>
          </div>

          <Card className="space-y-3 text-sm">
            <h2 className="text-base sm:text-lg font-extrabold">Rincian tagihan</h2>
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Iuran periode 3</span>
              <b>Rp250.000</b>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Penalti terlambat 3 hari (2% × 3)</span>
              <b className="text-red-800">Rp15.000</b>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Biaya admin</span>
              <b>Rp2.500</b>
            </div>
            <div className="flex items-end justify-between border-t border-sand pt-4">
              <b className="text-sm sm:text-base">Total</b>
              <b className="text-2xl sm:text-3xl tracking-tight">Rp267.500</b>
            </div>
            <p className="text-xs text-stone-500">
              Penalti dibaca dari smart contract saat checkout. Dana penalti masuk ke dana periode ini. Biaya admin bersifat ilustrasi.
            </p>
          </Card>

          <Card className="space-y-3 text-sm">
            <h2 className="text-base sm:text-lg font-extrabold">Pesanan</h2>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">Order ID</span>
              <span className="font-mono text-xs">LP-DPE-P3-M39AC</span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">Kunci idempotensi</span>
              <span className="font-mono text-xs">idem_8f2c91…</span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">Status</span>
              <Badge
                tone={
                  status === "SETTLED" || status === "ANCHORED"
                    ? "green"
                    : status === "SETTLED_PENDING_CHAIN"
                    ? "purple"
                    : status === "PENDING"
                    ? "amber"
                    : "red"
                }
              >
                {status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 pt-1">
              {statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    s === status
                      ? "border-brand bg-brand text-white"
                      : "border-sand text-stone-600 bg-white hover:bg-cream"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500">
              Satu order per kombinasi kelompok, periode, dan anggota. Klik badge status di atas untuk simulasi status webhook.
            </p>
          </Card>
        </div>

        <section className="h-fit overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between bg-ink px-4 sm:px-5 py-3.5 sm:py-4 text-white">
            <b className="text-xs sm:text-sm">Pembayaran (Snap sandbox)</b>
            <span className="text-xs sm:text-sm font-semibold text-white/80">Rp267.500</span>
          </div>

          {paymentSuccess ? (
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mint text-brand text-2xl font-bold">
                ✓
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-ink">Pembayaran Berhasil!</h3>
                <p className="mt-1 text-xs sm:text-sm text-stone-600">
                  Pembayaran melalui <b>{chosen}</b> telah berhasil diselesaikan pada gateway sandbox.
                </p>
              </div>
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-3.5 text-left text-xs space-y-1 text-violet-950">
                <div className="flex justify-between"><span>Status Gateway:</span><b>SETTLED</b></div>
                <div className="flex justify-between"><span>Status On-Chain:</span><b>SETTLED_PENDING_CHAIN</b></div>
                <div className="flex justify-between"><span>Nomor Referensi:</span><span className="font-mono">LP-DPE-P3-M39AC</span></div>
                <p className="text-[11px] text-violet-800 pt-1">
                  Worker outbox akan mencatat pembayaran ini ke smart contract Sepolia secara otomatis.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <Link to="/groups/1" className="flex-1">
                  <Button className="w-full text-xs sm:text-sm">Kembali ke Kelompok</Button>
                </Link>
                <Link to="/history" className="flex-1">
                  <Button variant="outline" className="w-full text-xs sm:text-sm">Lihat Riwayat</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4 p-4 sm:p-5">
              <b className="text-xs sm:text-sm block">Pilih metode pembayaran</b>
              <div className="space-y-2">
                {methods.map(([n, t]) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setChosen(n)}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 sm:p-4 text-left text-xs sm:text-sm transition cursor-pointer hover:border-brand ${
                      chosen === n ? "border-brand bg-mint font-semibold" : "border-sand bg-white"
                    }`}
                  >
                    <span>{n}</span>
                    <span className="text-xs text-stone-500">{t}</span>
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <Button
                  onClick={handleSimulatePayment}
                  disabled={!chosen || isProcessing}
                  className="w-full !py-3 text-sm font-bold shadow-sm"
                >
                  {isProcessing ? "Memproses Pembayaran Sandbox..." : `Bayar Rp267.500 lewat ${chosen || "Metode"}`}
                </Button>
              </div>

              <p className="text-xs text-stone-500 pt-1">
                QRIS sengaja tidak ditampilkan pada prototipe karena referensi sandbox QRIS dapat terhubung ke merchant produksi.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
