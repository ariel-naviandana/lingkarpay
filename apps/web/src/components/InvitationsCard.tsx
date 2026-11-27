import { useState } from "react";
import { api, ApiError, type PayoutAccountInput } from "../api";
import { useAuth } from "../context/useAuth";
import { useAsync } from "../hooks/useAsync";
import { formatYmd, rupiah } from "../lib/format";
import type { Invitation } from "../types";
import { PayoutAccountFields } from "./PayoutAccountFields";
import { Button, Card } from "./ui";

/** Undangan yang menunggu jawaban: terima (wajib isi rekening pencairan) atau tolak. */
export function InvitationsCard({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useAsync(() => api.invitations(), []);
  const invitations = data?.invitations ?? [];
  if (invitations.length === 0) return null;
  return (
    <Card className="space-y-3 border-amber-200">
      <h2 className="text-lg sm:text-xl font-extrabold">Undangan kelompok ({invitations.length})</h2>
      {invitations.map((inv) => (
        <InvitationRow
          key={inv.memberId}
          inv={inv}
          onDone={() => {
            void reload();
            onChanged();
          }}
        />
      ))}
    </Card>
  );
}

function InvitationRow({ inv, onDone }: { inv: Invitation; onDone: () => void }) {
  const { user } = useAuth();
  const c = inv.circle;
  const [accepting, setAccepting] = useState(false);
  const [account, setAccount] = useState<PayoutAccountInput>({ channel: "BCA", accountNumber: "", accountName: user?.name ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-sand pt-3 first:border-0 first:pt-0 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <b>{c.name}</b>
          <div className="text-xs text-stone-500">
            Diundang oleh {inv.creatorName} · {c.memberCount} anggota · iuran {rupiah(c.contributionAmount)} per{" "}
            {c.periodDays} hari · penalti {c.penaltyPct}% bila terlambat · biaya admin {rupiah(c.adminFee)}
            {c.startDate && ` · mulai ${formatYmd(c.startDate)}`}
            {(c.depositAmount ?? 0) > 0 && ` · jaminan ${rupiah(c.depositAmount!)} (dikembalikan di akhir)`} · urutan giliran
            diundi saat kelompok dikunci
          </div>
        </div>
        {!accepting && (
          <div className="flex gap-2">
            <Button className="!py-1.5 text-xs" disabled={busy} onClick={() => setAccepting(true)}>Terima</Button>
            <Button
              variant="outline"
              className="!py-1.5 text-xs"
              disabled={busy}
              onClick={() => {
                if (confirm(`Tolak undangan ke ${c.name}?`)) void act(() => api.declineInvitation(c.id));
              }}
            >
              Tolak
            </Button>
          </div>
        )}
      </div>
      {accepting && (
        <form
          className="space-y-3 rounded-xl bg-cream p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.acceptInvitation(c.id, account));
          }}
        >
          <p className="text-xs text-stone-600">
            Isi rekening pencairan Anda. Saat giliran Anda tiba, dana arisan ditransfer ke rekening ini.
          </p>
          <PayoutAccountFields value={account} onChange={setAccount} disabled={busy} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan..." : "Terima dan bergabung"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAccepting(false)}>Batal</Button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
