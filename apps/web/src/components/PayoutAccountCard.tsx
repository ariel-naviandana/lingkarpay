import { useState } from "react";
import { api, ApiError } from "../api";
import { accountLabel } from "../lib/format";
import { PAYOUT_CHANNELS, type MemberView } from "../types";
import { Button, Card, Field, Input, Select } from "./ui";

/**
 * Rekening pencairan milik anggota yang sedang login. Diisi sendiri oleh anggota, karena
 * penerima giliran yang menentukan ke mana dananya ditransfer. Data dummy (sandbox).
 */
export function PayoutAccountCard({ circleId, me, onChanged }: { circleId: number; me: MemberView; onChanged: () => void }) {
  const current = me.payoutAccount ?? null;
  const [editing, setEditing] = useState(!current);
  const [channel, setChannel] = useState(current?.channel ?? "BCA");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState(current?.accountName ?? me.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = PAYOUT_CHANNELS.find((c) => c.code === channel)?.kind ?? "bank";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.setPayoutAccount(circleId, { channel, accountNumber, accountName });
      setAccountNumber("");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan rekening");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg sm:text-xl font-extrabold">Rekening pencairan saya</h2>
        {current && !editing && (
          <Button variant="outline" className="!py-1.5 text-xs" onClick={() => setEditing(true)}>Ganti</Button>
        )}
      </div>

      {current && !editing && (
        <div className="rounded-xl bg-mint p-3 text-brand">
          <div className="text-xs">Saat giliran Anda, dana ditransfer ke</div>
          <b>{accountLabel(current)}</b>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="space-y-3">
          {!current && (
            <p className="rounded-xl bg-amber-soft p-3 text-xs text-amber-900">
              Isi rekening tujuan agar pencairan giliran Anda bisa dilakukan.
            </p>
          )}
          <Field label="Bank atau e-wallet">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <optgroup label="Bank">
                {PAYOUT_CHANNELS.filter((c) => c.kind === "bank").map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="E-wallet">
                {PAYOUT_CHANNELS.filter((c) => c.kind === "ewallet").map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field
            label={kind === "bank" ? "Nomor rekening" : "Nomor ponsel e-wallet"}
            hint="Data dummy (sandbox). Server hanya menyimpan 4 digit terakhir dan hash-nya."
          >
            <Input
              inputMode="numeric"
              required
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={kind === "bank" ? "mis. 1234567890" : "mis. 081234567890"}
            />
          </Field>
          <Field label="Nama pemilik rekening">
            <Input required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan..." : "Simpan rekening"}</Button>
            {current && (
              <Button type="button" variant="outline" onClick={() => { setEditing(false); setError(""); }}>Batal</Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
