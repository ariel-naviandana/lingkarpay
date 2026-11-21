import { useState } from "react";
import { api, ApiError } from "../api";
import type { CircleDetail } from "../types";
import { Button, Card, Input } from "./ui";

export default function DraftActions({ data, onChanged }: { data: CircleDetail; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const { circle, members } = data;
  const canStart = members.length >= 2;

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.addMember(circle.id, email.trim());
      setEmail("");
      setNotice("Anggota berhasil ditambahkan.");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Gagal menambah anggota");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!confirm(`Mulai kelompok ${circle.name}? Aturan akan dikunci di smart contract.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.startCircle(circle.id);
      setNotice("Kelompok berhasil dimulai!");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Gagal memulai kelompok");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-extrabold">Pengaturan Kelompok (Draft)</h2>
          <p className="text-xs text-stone-500">
            {members.length} dari {circle.memberCount} anggota telah bergabung.
          </p>
        </div>
        <Button
          onClick={() => void handleStart()}
          disabled={busy || !canStart}
          className="w-full sm:w-auto"
        >
          Kunci & Mulai Kelompok
        </Button>
      </div>

      <form onSubmit={(e) => void handleAddMember(e)} className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Input
            placeholder="Masukkan email anggota baru..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || members.length >= circle.memberCount}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !email.trim() || members.length >= circle.memberCount}
        >
          + Tambah Anggota
        </Button>
      </form>

      {notice && <p className="text-xs font-semibold text-brand">{notice}</p>}
      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
    </Card>
  );
}
