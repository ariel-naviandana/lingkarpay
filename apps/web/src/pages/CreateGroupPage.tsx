import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { rupiah } from "../lib/format";

const steps = ["Aturan kelompok", "Undang anggota", "Tinjau dan kunci"];

export default function CreateGroupPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const [f, setF] = useState({
    name: "Arisan Komunitas UMKM Malang",
    members: 6,
    fee: 300000,
    late: 2,
    cap: 10,
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === "name" ? e.target.value : Number(e.target.value.replace(/\D/g, "")) });

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      navigate("/groups/1");
    }
  };

  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Buat kelompok baru</h1>
        <p className="mt-1 text-xs sm:text-sm text-stone-500">
          Tiga langkah. Setelah dimulai, aturan dikunci di smart contract dan tidak bisa diubah siapa pun, termasuk Anda.
        </p>
      </header>

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
                  <Input value={f.name} onChange={set("name")} />
                </Field>
                <Field label="Jenis">
                  <Select>
                    <option>Arisan bergilir</option>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Jumlah anggota" hint="Paket gratis: maksimal 12 anggota">
                  <Input value={f.members} onChange={set("members")} />
                </Field>
                <Field label="Iuran per periode (Rp)" hint="Minimal Rp50.000 per anggota">
                  <Input value={f.fee.toLocaleString("id-ID")} onChange={set("fee")} />
                </Field>
                <Field label="Periode setoran">
                  <Select>
                    <option>Bulanan</option>
                    <option>Mingguan</option>
                  </Select>
                </Field>
                <Field label="Tanggal mulai">
                  <Input defaultValue="1 Desember 2026" />
                </Field>
              </div>
              <Field label="Tenggat bayar">
                <Select>
                  <option>5 hari setelah periode dibuka</option>
                  <option>7 hari setelah periode dibuka</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Penalti keterlambatan per hari (%)"
                  hint="Dihitung otomatis oleh contract dari tenggat"
                >
                  <Input value={f.late} onChange={set("late")} />
                </Field>
                <Field label="Batas maksimum penalti (%)">
                  <Input value={f.cap} onChange={set("cap")} />
                </Field>
              </div>
              <Field label="Kuorum keputusan">
                <Select>
                  <option>
                    Lebih dari separuh anggota ({Math.floor(f.members / 2) + 1} dari {f.members})
                  </option>
                </Select>
              </Field>
            </>
          )}
          {step === 1 && (
            <Field label="Email anggota" hint="Pisahkan dengan koma. Undangan berlaku 7 hari.">
              <Input placeholder="sari@contoh.id, ardi@contoh.id" />
            </Field>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                Periksa aturan di atas. Setelah dikunci, nama penerima tiap giliran, iuran, dan penalti tidak bisa diubah oleh siapa pun.
              </p>
              <div className="rounded-xl border border-sand bg-cream/60 p-4 text-xs space-y-1.5 text-stone-700">
                <div className="flex justify-between"><span>Kelompok:</span><b>{f.name}</b></div>
                <div className="flex justify-between"><span>Anggota:</span><b>{f.members} orang</b></div>
                <div className="flex justify-between"><span>Iuran:</span><b>{rupiah(f.fee)} / periode</b></div>
                <div className="flex justify-between"><span>Penalti:</span><b>{f.late}% / hari (maks {f.cap}%)</b></div>
              </div>
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              className="w-full sm:w-auto"
            >
              Kembali
            </Button>
            <Button
              onClick={handleNext}
              className="w-full sm:w-auto"
            >
              {["Lanjut: undang anggota", "Lanjut: tinjau", "Kunci dan mulai kelompok"][step]}
            </Button>
          </div>
        </Card>

        <Card className="h-fit space-y-3 text-sm">
          <p className="font-semibold text-stone-500">Perkiraan per periode</p>
          <p className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            {rupiah(f.members * f.fee)}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {f.members} anggota × {rupiah(f.fee)}, diterima satu anggota bergiliran
          </p>
          {[
            ["Durasi", `${f.members} bulan`],
            ["Biaya admin per pembayaran", "Rp2.500"],
            ["Paket", "Gratis"],
          ].map(([a, b]) => (
            <div key={a} className="flex justify-between border-t border-sand pt-3 text-xs sm:text-sm">
              <span className="text-stone-500">{a}</span>
              <b>{b}</b>
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Biaya admin dan paket langganan di sini bersifat ilustrasi sampai tarif final ditetapkan di business case.
          </p>
        </Card>
      </div>
    </div>
  );
}
