import { useNavigate, useParams, Link } from "react-router-dom";
import { Badge, Card, Logo, Loading, ErrorBox } from "../components/ui";
import PayButton from "../components/PayButton";
import { useAsync } from "../hooks/useAsync";
import { api } from "../api";
import { rupiah } from "../lib/format";

export default function PaymentPage() {
  const { id = "1" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsync(
    () => api.circle(Number(id)),
    [id],
  );

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <Loading />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-cream p-6 sm:p-8 space-y-4">
        <Link to={`/groups/${id}`} className="text-xs sm:text-sm font-semibold hover:text-brand transition">
          ‹ Kembali ke kelompok
        </Link>
        <ErrorBox message={error || "Gagal memuat data kelompok dari server."} onRetry={reload} />
      </div>
    );
  }

  const circle = data.circle;
  const currentPeriod = data.periods?.find((p) => p.status === "running") ?? data.currentPeriod ?? null;

  const circleId  = circle.id;
  const periodId  = currentPeriod?.id ?? 0;
  const memberId  = data.myMemberId ?? 0;
  const iuran     = circle.contributionAmount;
  const penalty   = circle.penaltyPct;
  const adminFee  = circle.adminFee;
  const groupName = circle.name;
  const periodNo  = currentPeriod?.periodNo ?? 1;

  // Estimated penalty (3-day late as placeholder — real value comes from checkout response)
  const estimatedPenalty = Math.round(iuran * (penalty / 100) * 3);
  const total = iuran + estimatedPenalty + adminFee;
  const isRunning = currentPeriod?.status === "running";

  return (
    <div className="min-h-screen bg-cream">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sand bg-white px-4 py-3 sm:px-6 sm:py-4">
        <Link to={`/groups/${id}`} className="text-xs sm:text-sm font-semibold hover:text-brand transition">
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
              {groupName} · Periode {periodNo} ·{" "}
              {currentPeriod?.dueDate
                ? new Date(currentPeriod.dueDate).toLocaleDateString("id-ID", { month: "long", year: "numeric" })
                : "–"}
            </p>
          </div>

          <Card className="space-y-3 text-sm">
            <h2 className="text-base sm:text-lg font-extrabold">Rincian tagihan</h2>
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Iuran periode {periodNo}</span>
              <b>{rupiah(iuran)}</b>
            </div>
            {estimatedPenalty > 0 && (
              <div className="flex justify-between text-xs sm:text-sm">
                <span>Estimasi penalti keterlambatan ({penalty}% × 3 hari)</span>
                <b className="text-red-800">{rupiah(estimatedPenalty)}</b>
              </div>
            )}
            <div className="flex justify-between text-xs sm:text-sm">
              <span>Biaya admin</span>
              <b>{rupiah(adminFee)}</b>
            </div>
            <div className="flex items-end justify-between border-t border-sand pt-4">
              <b className="text-sm sm:text-base">Total (estimasi)</b>
              <b className="text-2xl sm:text-3xl tracking-tight">{rupiah(total)}</b>
            </div>
            <p className="text-xs text-stone-500">
              Penalti dibaca dari smart contract saat checkout. Dana penalti masuk ke dana periode ini. Biaya admin bersifat ilustrasi.
            </p>
          </Card>

          <Card className="space-y-2 text-sm">
            <h2 className="text-base sm:text-lg font-extrabold">Info transaksi</h2>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">ID kelompok</span>
              <span className="font-mono text-xs">{circleId}</span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">ID periode</span>
              <span className="font-mono text-xs">{periodId || "–"}</span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-stone-500">ID anggota</span>
              <span className="font-mono text-xs">{memberId || "–"}</span>
            </div>
            <p className="text-xs text-stone-500">
              Satu order per kombinasi kelompok, periode, dan anggota — dijamin idempotensi oleh backend.
            </p>
          </Card>
        </div>

        <section className="h-fit overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between bg-ink px-4 sm:px-5 py-3.5 sm:py-4 text-white">
            <b className="text-xs sm:text-sm">Pembayaran (Snap sandbox)</b>
            <span className="text-xs sm:text-sm font-semibold text-white/80">{rupiah(total)}</span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {isRunning && periodId > 0 && memberId > 0 ? (
              <>
                <p className="text-xs sm:text-sm text-stone-600">
                  Klik tombol di bawah untuk membuka jendela pembayaran Midtrans Snap (sandbox). Pilih metode pembayaran yang tersedia dan selesaikan transaksi.
                </p>

                <PayButton
                  circleId={circleId}
                  periodId={periodId}
                  memberId={memberId}
                  onPaid={() => navigate(`/groups/${id}`)}
                />
              </>
            ) : isRunning ? (
              <div className="rounded-xl border border-amber-200 bg-amber-soft p-4 text-xs sm:text-sm text-amber-950 space-y-1">
                <b>Data Anggota Tidak Ditemukan</b>
                <p className="text-amber-900">
                  {!memberId
                    ? "Anda belum terdaftar sebagai anggota kelompok ini sehingga tidak dapat membayar iuran."
                    : "Tidak ada periode aktif yang dapat dibayar saat ini."}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-soft p-4 text-xs sm:text-sm text-amber-950 space-y-1">
                <b>Periode tidak sedang menerima iuran</b>
                <p className="text-amber-900">
                  {currentPeriod?.status === "ready_payout"
                    ? "Periode ini telah ditutup (status Siap Cair) dan tidak lagi menerima iuran baru. Pengelola dapat melakukan pencairan dari halaman kelompok."
                    : circle.status === "draft"
                    ? "Kelompok ini belum dimulai oleh pengelola. Iuran baru dapat dibayar setelah kelompok dimulai."
                    : "Tidak ada periode berjalan yang menerima pembayaran saat ini."}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Link to={`/groups/${id}`} className="flex-1">
                <button className="w-full rounded-xl border border-sand px-4 py-2.5 text-xs sm:text-sm font-semibold text-stone-700 hover:bg-cream transition">
                  Kembali ke Kelompok
                </button>
              </Link>
              <Link to="/history" className="flex-1">
                <button className="w-full rounded-xl border border-sand px-4 py-2.5 text-xs sm:text-sm font-semibold text-stone-700 hover:bg-cream transition">
                  Lihat Riwayat
                </button>
              </Link>
            </div>

            <p className="text-xs text-stone-500">
              QRIS sengaja tidak ditampilkan pada prototipe karena referensi sandbox QRIS dapat terhubung ke merchant produksi.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
