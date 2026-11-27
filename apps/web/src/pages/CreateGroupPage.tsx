import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Card, Field, Input, Select, Badge, ErrorBox, CalendarDropdown } from "../components/ui";
import { PayoutAccountFields } from "../components/PayoutAccountFields";
import { accountLabel, formatYmd, rupiah, todayWib } from "../lib/format";
import { api, ApiError, type PayoutAccountInput } from "../api";
import { useAsync } from "../hooks/useAsync";
import { PAYOUT_CHANNELS } from "../types";

const steps = ["Aturan kelompok", "Rekening dan undangan", "Tinjau dan simpan"];

export default function CreateGroupPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Biaya admin ditetapkan aplikasi, bukan oleh pembuat kelompok.
  const { data: cfg } = useAsync(() => api.publicConfig(), []);
  const adminFee = cfg?.adminFee ?? null;

  const [f, setF] = useState({
    name: "",
    members: 3,
    fee: 100000,
    periodType: "Bulanan" as "Bulanan" | "Mingguan",
    late: 5,
    startDate: todayWib(),
  });
  const [account, setAccount] = useState<PayoutAccountInput>({ channel: "BCA", accountNumber: "", accountName: "" });
  const [inviteEmails, setInviteEmails] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setF((prev) => ({
      ...prev,
      [k]: k === "name" || k === "periodType" || k === "startDate" ? val : Number(val.replace(/\D/g, "")),
    }));
  };

  const periodDays = f.periodType === "Mingguan" ? 7 : 30;
  // Sama dengan server: jaminan = iuran + penalti keterlambatan (dibulatkan ke atas).
  const deposit = f.fee + Math.floor((f.fee * f.late + 99) / 100);
  const channelLabel = PAYOUT_CHANNELS.find((c) => c.code === account.channel)?.label ?? account.channel;
  const digits = account.accountNumber.replace(/[\s-]/g, "");

  const handleNext = async () => {
    setError(null);
    if (step === 0) {
      if (!f.name.trim()) return setError("Nama kelompok tidak boleh kosong.");
      if (f.members < 2 || f.members > 50) return setError("Jumlah anggota harus antara 2 hingga 50 orang.");
      if (f.fee < 1000) return setError("Iuran minimal Rp1.000 per periode.");
      if (f.late > 100) return setError("Penalti maksimal 100%.");
      if (!f.startDate || f.startDate < todayWib()) return setError("Tanggal mulai tidak boleh sebelum hari ini.");
      setStep(1);
    } else if (step === 1) {
      if (!digits || !account.accountName.trim()) {
        return setError("Isi rekening pencairan Anda: sebagai anggota, Anda juga akan menerima giliran.");
      }
      setStep(2);
    } else {
      setBusy(true);
      try {
        const newCircle = await api.createCircle({
          name: f.name.trim(),
          contributionAmount: f.fee,
          memberCount: f.members,
          periodDays,
          penaltyPct: f.late,
          startDate: f.startDate,
          payoutAccount: account,
        });

        const emailList = inviteEmails
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e.includes("@"));
        const failed: string[] = [];
        for (const email of emailList) {
          try {
            await api.addMember(newCircle.id, email);
          } catch {
            failed.push(email);
          }
        }
        if (failed.length > 0) {
          setNotice(`Kelompok dibuat. Undangan gagal untuk: ${failed.join(", ")} (belum terdaftar?). Undang ulang dari halaman kelompok.`);
          setTimeout(() => navigate(`/groups/${newCircle.id}`), 2500);
        } else {
          navigate(`/groups/${newCircle.id}`);
        }
      } catch (err: unknown) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Gagal membuat kelompok baru. Pastikan server API berjalan.",
        );
      } finally {
        setBusy(false);
      }
    }
  };

  const review: [string, string][] = [
    ["Nama kelompok", f.name],
    ["Peran Anda", "Pengelola (anggota pertama)"],
    ["Jumlah anggota", `${f.members} orang`],
    ["Iuran per periode", rupiah(f.fee)],
    ["Periode setoran", `${f.periodType} (${periodDays} hari)`],
    ["Tanggal mulai", `${formatYmd(f.startDate)} (paling cepat dikunci pada tanggal ini)`],
    ["Urutan giliran", "Diundi acak oleh sistem saat kelompok dikunci"],
    ["Penalti keterlambatan", f.late > 0 ? `${f.late}% dari iuran, sekali bila lewat tenggat` : "Tidak ada"],
    ["Biaya admin per pembayaran", adminFee !== null ? `${rupiah(adminFee)} (ditetapkan aplikasi)` : "–"],
    ["Dana jaminan per anggota", `${rupiah(deposit)} (iuran + penalti, dikembalikan di akhir)`],
    ["Kuorum keputusan", `${Math.floor(f.members / 2) + 1} dari ${f.members} anggota`],
    ["Rekening pencairan Anda", digits ? accountLabel({ channelLabel, last4: digits.slice(-4), accountName: account.accountName }) : "–"],
  ];

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1">
            <Link to="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-brand transition">
              ‹ Kembali ke dashboard
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Buat kelompok baru</h1>
          <p className="mt-1 text-xs sm:text-sm text-stone-500">
            Anda otomatis menjadi pembuat dan anggota pertama kelompok ini.
          </p>
        </div>
        <Badge tone="purple">Aturan dikunci di smart contract</Badge>
      </header>

      {error && <ErrorBox message={error} />}
      {notice && <p className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">{notice}</p>}

      <ol className="grid gap-2 sm:gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-3 rounded-xl border px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold ${
              i === step ? "border-brand bg-mint text-brand" : "border-sand bg-white text-stone-600"
            }`}
          >
            <span
              className={`grid h-5 w-5 sm:h-6 sm:w-6 shrink-0 place-items-center rounded-full text-xs ${
                i === step ? "bg-brand text-white" : "bg-sand"
              }`}
            >
              {i + 1}
            </span>
            <span className="truncate">{s}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
        <Card className="space-y-4">
          <h2 className="text-lg sm:text-xl font-extrabold">{steps[step]}</h2>

          {step === 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-[2fr_1.2fr]">
                <Field label="Nama kelompok">
                  <Input value={f.name} onChange={set("name")} placeholder="Contoh: Arisan Keluarga Besar" />
                </Field>
                <Field label="Jenis arisan">
                  <Select value="bergilir" disabled>
                    <option value="bergilir">Arisan bergilir</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Jumlah anggota" hint="2 hingga 50 anggota, termasuk Anda">
                  <Input value={f.members} onChange={set("members")} type="number" min={2} max={50} />
                </Field>
                <Field label="Iuran per periode (Rp)" hint="Minimal Rp1.000">
                  <Input value={f.fee.toLocaleString("id-ID")} onChange={set("fee")} />
                </Field>
                <Field label="Periode setoran" hint="Tenggat periode pertama dihitung dari saat kelompok dikunci">
                  <Select value={f.periodType} onChange={set("periodType")}>
                    <option value="Bulanan">Bulanan (30 hari)</option>
                    <option value="Mingguan">Mingguan (7 hari)</option>
                  </Select>
                </Field>
                <Field label="Penalti keterlambatan (%)" hint="Persentase dari iuran, dikenakan sekali bila membayar lewat tenggat">
                  <Input value={f.late} onChange={set("late")} type="number" min={0} max={100} />
                </Field>
                <Field
                  label="Tanggal mulai"
                  hint="Kelompok baru bisa dikunci pada atau sesudah tanggal ini, dan setelah semua undangan diterima"
                >
                  <CalendarDropdown
                    value={f.startDate}
                    minDate={todayWib()}
                    onChange={(d) => setF((prev) => ({ ...prev, startDate: d }))}
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-sand bg-cream/60 p-3 text-xs sm:text-sm text-stone-600">
                Biaya admin per pembayaran:{" "}
                <b className="text-ink">{adminFee !== null ? rupiah(adminFee) : "–"}</b>, ditetapkan aplikasi (pendapatan
                platform, tidak ikut dicairkan). Dana jaminan per anggota: <b className="text-ink">{rupiah(deposit)}</b> (satu
                iuran + penalti), disetor sebelum kelompok dikunci dan dikembalikan saat selesai. Kuorum keputusan darurat:
                mayoritas mutlak ({Math.floor(f.members / 2) + 1} dari {f.members}).
              </div>
            </>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-sm font-bold">Rekening pencairan Anda</h3>
                <p className="text-xs text-stone-500">
                  Anda juga anggota yang mendapat giliran. Dana giliran Anda ditransfer ke rekening ini.
                </p>
                <PayoutAccountFields value={account} onChange={setAccount} disabled={busy} />
              </div>

              <Field
                label="Email anggota yang diundang (opsional)"
                hint={`Pisahkan dengan koma. Penerima harus sudah terdaftar; mereka menerima atau menolak undangan dari dashboard dan wajib mengisi rekening saat menerima. Undang ${f.members - 1} orang, sekarang atau nanti.`}
              >
                <textarea
                  className="w-full rounded-xl border border-sand bg-white p-3 text-sm focus:border-brand focus:outline-none"
                  rows={3}
                  placeholder="andi@contoh.id, rina@contoh.id"
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-stone-600">
                Kelompok berstatus <b>Draft</b> sampai semua undangan diterima, semua anggota menyetor jaminan, dan tanggal
                mulai tiba. Saat Anda menguncinya,
                sistem mengundi urutan giliran secara acak (seed undian ditampilkan agar bisa diperiksa ulang), lalu aturan
                dan urutan dicatat di smart contract dan tidak bisa diubah.
              </p>
              <div className="rounded-xl border border-sand bg-cream/60 p-4 text-xs sm:text-sm space-y-2 text-stone-700">
                {review.map(([a, b]) => (
                  <div key={a} className="flex justify-between gap-3">
                    <span>{a}</span>
                    <b className="text-right">{b}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
              className="w-full sm:w-auto"
            >
              Kembali
            </Button>
            <Button onClick={() => void handleNext()} disabled={busy} className="w-full sm:w-auto">
              {busy
                ? "Membuat kelompok..."
                : step === 0
                ? "Lanjut: rekening dan undangan"
                : step === 1
                ? "Lanjut: tinjau"
                : "Buat kelompok sekarang"}
            </Button>
          </div>
        </Card>

        <Card className="h-fit space-y-3 text-sm">
          <p className="font-semibold text-stone-500">Dana per giliran</p>
          <p className="text-3xl sm:text-4xl font-extrabold tracking-tight">{rupiah(f.members * f.fee)}</p>
          <p className="text-xs sm:text-sm text-stone-500">
            {f.members} anggota × {rupiah(f.fee)}, dicairkan ke satu anggota bergiliran.
          </p>
          {[
            ["Tanggal mulai", formatYmd(f.startDate)],
            ["Durasi kelompok", `${f.members} periode (${f.members * periodDays} hari)`],
            ["Biaya admin per pembayaran", adminFee !== null ? rupiah(adminFee) : "–"],
            ["Dana jaminan per anggota", rupiah(deposit)],
            ["Status awal", "Draft (menunggu anggota)"],
          ].map(([a, b]) => (
            <div key={a} className="flex justify-between border-t border-sand pt-3 text-xs sm:text-sm">
              <span className="text-stone-500">{a}</span>
              <b>{b}</b>
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Bila ada anggota tidak membayar dan periode ditutup lewat kuorum, iurannya menjadi tunggakan yang dipotong dari
            jatahnya saat gilirannya tiba, lalu diteruskan ke penerima yang kurang.
          </p>
        </Card>
      </div>
    </div>
  );
}
