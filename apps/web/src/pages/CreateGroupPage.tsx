import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Card, Field, Input, Select, Badge, ErrorBox, CalendarDropdown } from "../components/ui";
import { rupiah } from "../lib/format";
import { api, ApiError } from "../api";

const steps = ["Aturan kelompok", "Undang anggota", "Tinjau dan simpan"];

export default function CreateGroupPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split("T")[0];

  const [f, setF] = useState({
    name: "Arisan Komunitas UMKM Malang",
    members: 6,
    fee: 300000,
    periodType: "Bulanan" as "Bulanan" | "Mingguan",
    startDate: todayStr,
    late: 2,
    cap: 10,
    adminFee: 2500,
  });

  const [inviteEmails, setInviteEmails] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setF((prev) => ({
      ...prev,
      [k]:
        k === "name" || k === "periodType" || k === "startDate"
          ? val
          : Number(val.replace(/\D/g, "")),
    }));
  };

  const handleNext = async () => {
    setError(null);
    if (step === 0) {
      if (!f.name.trim()) {
        setError("Nama kelompok tidak boleh kosong.");
        return;
      }
      if (f.members < 2 || f.members > 50) {
        setError("Jumlah anggota harus antara 2 hingga 50 orang.");
        return;
      }
      if (f.fee < 1000) {
        setError("Iuran minimal Rp1.000 per periode.");
        return;
      }
      if (!f.startDate) {
        setError("Tanggal mulai harus dipilih.");
        return;
      }
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else {
      // Step 2: Final submission
      setBusy(true);
      setError(null);
      try {
        const periodDays = f.periodType === "Mingguan" ? 7 : 30;
        const newCircle = await api.createCircle({
          name: f.name.trim(),
          contributionAmount: f.fee,
          memberCount: f.members,
          periodDays,
          penaltyPct: f.late,
          adminFee: f.adminFee,
        });

        // Undang anggota yang diinput jika ada
        const emailList = inviteEmails
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e.includes("@"));

        for (const email of emailList) {
          try {
            await api.addMember(newCircle.id, email);
          } catch {
            // Abaikan jika email belum terdaftar, nanti bisa diundang lagi dari halaman detail
          }
        }

        // Langsung arahkan ke Dashboard agar kelompok baru langsung muncul
        navigate("/dashboard");
      } catch (err: unknown) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Gagal membuat kelompok baru. Pastikan server API berjalan."
        );
      } finally {
        setBusy(false);
      }
    }
  };

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
        <Badge tone="purple">Smart Contract Ready</Badge>
      </header>

      {error && (
        <ErrorBox message={error} />
      )}

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
                <Field label="Jumlah anggota" hint="2 hingga 50 anggota">
                  <Input value={f.members} onChange={set("members")} type="number" min={2} max={50} />
                </Field>
                <Field label="Iuran per periode (Rp)" hint="Minimal Rp1.000">
                  <Input value={f.fee.toLocaleString("id-ID")} onChange={set("fee")} />
                </Field>
                <Field label="Periode setoran">
                  <Select value={f.periodType} onChange={set("periodType")}>
                    <option value="Bulanan">Bulanan (30 hari)</option>
                    <option value="Mingguan">Mingguan (7 hari)</option>
                  </Select>
                </Field>
                <Field label="Tanggal mulai" hint="Pilih tanggal mulai periode pertama melalui kalender">
                  <CalendarDropdown
                    value={f.startDate}
                    minDate={todayStr}
                    onChange={(dateStr) => setF((prev) => ({ ...prev, startDate: dateStr }))}
                  />
                </Field>
                <Field label="Biaya admin (Rp)" hint="Biaya transaksi platform">
                  <Input value={f.adminFee.toLocaleString("id-ID")} onChange={set("adminFee")} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Penalti keterlambatan per hari (%)"
                  hint="Dihitung otomatis per hari keterlambatan"
                >
                  <Input value={f.late} onChange={set("late")} type="number" min={0} max={100} />
                </Field>
                <Field label="Batas maksimum penalti (%)" hint="Ilustrasi aturan batas">
                  <Input value={f.cap} onChange={set("cap")} type="number" min={0} max={100} />
                </Field>
              </div>

              <Field label="Kuorum keputusan darurat">
                <Select disabled>
                  <option>
                    Mayoritas mutlak ({Math.floor(f.members / 2) + 1} dari {f.members} anggota)
                  </option>
                </Select>
              </Field>
            </>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-xl bg-mint/50 border border-brand/20 p-4 text-xs sm:text-sm text-brand space-y-1">
                <b>✓ Anda otomatis terdaftar sebagai Anggota #1 (Pengelola)</b>
                <p className="text-stone-600">
                  Anda tidak perlu memasukkan email Anda sendiri. Anda dapat mengundang anggota lainnya ({f.members - 1} orang) sekarang atau nanti melalui halaman kelompok.
                </p>
              </div>

              <Field
                label="Email anggota yang diundang (opsional)"
                hint="Pisahkan beberapa email dengan tanda koma (,). Contoh: user1@email.com, user2@email.com"
              >
                <textarea
                  className="w-full rounded-xl border border-sand bg-white p-3 text-sm focus:border-brand focus:outline-none"
                  rows={4}
                  placeholder="andi@gmail.com, rina@yahoo.com"
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-stone-600">
                Periksa kembali aturan kelompok Anda di bawah ini sebelum membuat kelompok. Setelah dibuat, kelompok akan berstatus <b>Draft</b> sampai semua anggota bergabung dan Anda menguncinya di smart contract.
              </p>
              <div className="rounded-xl border border-sand bg-cream/60 p-4 text-xs sm:text-sm space-y-2 text-stone-700">
                <div className="flex justify-between">
                  <span>Nama Kelompok:</span>
                  <b>{f.name}</b>
                </div>
                <div className="flex justify-between">
                  <span>Peran Anda:</span>
                  <b className="text-brand">Pengelola (Anggota #1)</b>
                </div>
                <div className="flex justify-between">
                  <span>Kapasitas Anggota:</span>
                  <b>{f.members} orang</b>
                </div>
                <div className="flex justify-between">
                  <span>Iuran per Periode:</span>
                  <b>{rupiah(f.fee)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Periode Setoran:</span>
                  <b>{f.periodType} ({f.periodType === "Mingguan" ? "7" : "30"} hari)</b>
                </div>
                <div className="flex justify-between">
                  <span>Tanggal Mulai:</span>
                  <b>{new Date(f.startDate + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</b>
                </div>
                <div className="flex justify-between">
                  <span>Penalti Keterlambatan:</span>
                  <b>{f.late}% per hari</b>
                </div>
                <div className="flex justify-between">
                  <span>Biaya Admin:</span>
                  <b>{rupiah(f.adminFee)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Kuorum Usulan:</span>
                  <b>{Math.floor(f.members / 2) + 1} dari {f.members} suara</b>
                </div>
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
            <Button
              onClick={() => void handleNext()}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              {busy
                ? "Membuat kelompok..."
                : step === 0
                ? "Lanjut: undang anggota"
                : step === 1
                ? "Lanjut: tinjau"
                : "Buat kelompok sekarang"}
            </Button>
          </div>
        </Card>

        {/* Ringkasan Samping */}
        <Card className="h-fit space-y-3 text-sm">
          <p className="font-semibold text-stone-500">Perkiraan per periode</p>
          <p className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            {rupiah(f.members * f.fee)}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {f.members} anggota × {rupiah(f.fee)}, dicairkan ke satu anggota bergiliran.
          </p>
          {[
            ["Tanggal mulai", new Date(f.startDate + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })],
            ["Durasi kelompok", `${f.members} periode (${f.periodType === "Mingguan" ? f.members * 7 : f.members * 30} hari)`],
            ["Biaya admin per pembayaran", rupiah(f.adminFee)],
            ["Status awal", "Draft (Menunggu anggota)"],
          ].map(([a, b]) => (
            <div key={a} className="flex justify-between border-t border-sand pt-3 text-xs sm:text-sm">
              <span className="text-stone-500">{a}</span>
              <b>{b}</b>
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Setelah kelompok dimulai, giliran ditentukan dan aturan terkunci secara terdesentralisasi.
          </p>
        </Card>
      </div>
    </div>
  );
}
