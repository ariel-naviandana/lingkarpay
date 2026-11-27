import { useState } from "react";
import { api, ApiError } from "../api";
import type { CircleDetail } from "../types";
import { formatYmd, todayWib } from "../lib/format";
import { Badge, Button, Card, Input } from "./ui";

/** Pengaturan kelompok draft (pembuat): undang anggota, pantau undangan, lalu kunci dan mulai. */
export default function DraftActions({ data, onChanged }: { data: CircleDetail; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const { circle, members } = data;
  const active = members.filter((m) => (m.status ?? "active") === "active");
  const invited = members.filter((m) => m.status === "invited");
  const seatsLeft = circle.memberCount - members.length;
  const membersReady = active.length === circle.memberCount && invited.length === 0;
  const needsDeposit = (circle.depositAmount ?? 0) > 0;
  const hasDeposit = (memberId: number) => (data.deposits ?? []).some((d) => d.memberId === memberId);
  const missingDeposit = needsDeposit ? active.filter((m) => !hasDeposit(m.memberId)) : [];
  // Tanggal mulai dicek ulang di server (WIB); di sini hanya untuk menonaktifkan tombol lebih awal.
  const dateReached = !circle.startDate || circle.startDate.slice(0, 10) <= todayWib();
  const canStart = membersReady && dateReached && missingDeposit.length === 0;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await fn());
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await run(async () => {
      const r = await api.addMember(circle.id, email.trim());
      setEmail("");
      return `Undangan terkirim ke ${r.name}. Kursi terisi setelah undangan diterima.`;
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-extrabold">Pengaturan kelompok (draft)</h2>
          <p className="text-xs text-stone-500">
            {active.length} dari {circle.memberCount} anggota sudah bergabung
            {invited.length > 0 && ` · ${invited.length} undangan menunggu jawaban`}.
            {circle.startDate && ` Tanggal mulai: ${formatYmd(circle.startDate)}.`}
          </p>
        </div>
        <Button
          onClick={() => {
            if (
              confirm(
                `Mulai kelompok ${circle.name}? Urutan giliran akan diundi acak oleh sistem, lalu urutan dan aturan dikunci di smart contract.`,
              )
            ) {
              void run(async () => {
                await api.startCircle(circle.id);
                return "Kelompok dimulai. Urutan giliran hasil undian tampil di daftar anggota.";
              });
            }
          }}
          disabled={busy || !canStart}
          className="w-full sm:w-auto"
        >
          Kunci & mulai kelompok
        </Button>
      </div>

      {!canStart && (
        <p className="rounded-xl bg-cream p-3 text-xs text-stone-600">
          {!membersReady
            ? `Kelompok bisa dimulai setelah ${circle.memberCount} anggota bergabung dan semua undangan dijawab.`
            : missingDeposit.length > 0
            ? `Menunggu dana jaminan dari: ${missingDeposit.map((m) => m.name).join(", ")}.`
            : `Semua anggota sudah bergabung. Kelompok bisa dikunci mulai ${formatYmd(circle.startDate)} (tanggal mulai yang disepakati).`}
        </p>
      )}
      <p className="text-xs text-stone-500">
        Urutan giliran tidak ditentukan pembuat: sistem mengundinya saat kelompok dikunci, dan seed undian dibuka agar
        setiap anggota bisa memeriksa ulang hasilnya.
      </p>

      {needsDeposit && active.length > 0 && (
        <ul className="space-y-2">
          {active.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between gap-3 rounded-xl border border-sand p-2.5 text-sm">
              <span>
                <b>{m.name}</b>{m.isMe ? " (Anda)" : ""}{" "}
                {hasDeposit(m.memberId) ? <Badge tone="green">Jaminan disetor</Badge> : <Badge tone="amber">Jaminan belum</Badge>}
              </span>
              {!m.isMe && !hasDeposit(m.memberId) && (
                <Button
                  variant="outline"
                  className="!py-1 text-xs"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Keluarkan ${m.name} dari kelompok? Kursinya bisa diisi orang lain.`)) {
                      void run(async () => {
                        await api.removeMember(circle.id, m.memberId);
                        return `${m.name} dikeluarkan dari kelompok.`;
                      });
                    }
                  }}
                >
                  Keluarkan
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {invited.length > 0 && (
        <ul className="space-y-2">
          {invited.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between gap-3 rounded-xl border border-sand p-2.5 text-sm">
              <span>
                <b>{m.name}</b> <Badge tone="amber">Menunggu konfirmasi</Badge>
              </span>
              <Button
                variant="outline"
                className="!py-1 text-xs"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Batalkan undangan untuk ${m.name}?`)) {
                    void run(async () => {
                      await api.cancelInvitation(circle.id, m.memberId);
                      return `Undangan untuk ${m.name} dibatalkan.`;
                    });
                  }
                }}
              >
                Batalkan
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void handleInvite(e)} className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Input
            placeholder={seatsLeft > 0 ? "Email pengguna terdaftar yang diundang..." : "Kursi sudah penuh"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || seatsLeft <= 0}
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy || !email.trim() || seatsLeft <= 0}>
          + Undang anggota
        </Button>
      </form>

      <div className="flex justify-end border-t border-sand pt-3">
        <Button
          variant="outline"
          className="!py-1.5 text-xs text-red-700"
          disabled={busy}
          onClick={() => {
            if (confirm(`Batalkan kelompok ${circle.name}? Undangan gugur dan jaminan yang sudah disetor dikembalikan. Tindakan ini tidak bisa diurungkan.`)) {
              void run(async () => {
                const r = await api.cancelCircle(circle.id);
                return `Kelompok dibatalkan. ${r.depositsRefunded} jaminan dikembalikan ke rekening anggota.`;
              });
            }
          }}
        >
          Batalkan kelompok
        </Button>
      </div>

      {notice && <p className="text-xs font-semibold text-brand">{notice}</p>}
      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
    </Card>
  );
}
