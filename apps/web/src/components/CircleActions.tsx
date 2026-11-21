import { useState } from "react";
import { api, ApiError } from "../api";
import type { CircleDetail, MemberView, Period, Proposal } from "../types";
import { dateTime, rupiah } from "../lib/format";
import { Badge, Button, Card, ProgressBar } from "./ui";

const ERR: Record<string, string> = {
  PROPOSAL_EXISTS: "Sudah ada usulan terbuka untuk periode ini.",
  PERIOD_COMPLETE: "Semua iuran periode ini sudah lunas, tidak perlu usulan.",
  PERIOD_NOT_OPEN: "Periode ini tidak sedang berjalan.",
  ALREADY_VOTED: "Anda sudah memberi suara.",
  VOTING_CLOSED: "Batas waktu voting sudah lewat.",
  PROPOSAL_NOT_OPEN: "Usulan ini sudah tidak terbuka.",
  PERIOD_NOT_READY: "Periode belum siap cair.",
  PAYOUT_EXISTS: "Pencairan periode ini sudah dibuat.",
};
const msg = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status >= 500) return "Server tidak dapat dihubungi saat ini. Pastikan backend API sudah berjalan.";
    return ERR[e.code] ?? e.message;
  }
  return e instanceof Error ? e.message : "Gagal";
};

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(""); setOk("");
    try { setOk((await fn()) ?? ""); onDone(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  return { busy, error, ok, run };
}

const label = { open: "Terbuka", rejected: "Ditolak", expired: "Kedaluwarsa", executed: "Disetujui" } as const;

/** Kartu kuorum: lihat usulan, usulkan tutup periode, dan beri suara. */
export function QuorumCard({ detail, proposal, onChanged }: { detail: CircleDetail; proposal?: Proposal; onChanged: () => void }) {
  const { circle, members, currentPeriod: cp } = detail;
  const a = useAction(onChanged);
  const paid = members.filter((m: MemberView) => m.currentPayment?.paid).length;
  const open = proposal?.status === "open" ? proposal : undefined;
  const [now] = useState(() => Date.now());
  const canPropose = circle.status === "active" && cp?.status === "running" && paid > 0 && paid < members.length && !open;
  const canVote = !!open && open.myVote === null && new Date(open.deadline).getTime() > now;

  return (
    <Card className="space-y-3 text-sm">
      <h2 className="text-xl font-extrabold">Keputusan kuorum</h2>
      {!proposal ? (
        <p className="text-stone-500">
          {circle.status === "active" && cp?.status === "running" && paid === 0
            ? "Belum ada usulan. Usulan penutupan darurat hanya dapat dibuat setelah minimal ada 1 iuran yang dibayar."
            : "Belum ada usulan untuk kelompok ini."}
        </p>
      ) : (<>
        <p><b>Usulan:</b> tutup periode {proposal.periodNo} dengan dana yang terkumpul.{" "}
          <Badge tone={proposal.status === "executed" ? "green" : proposal.status === "open" ? "purple" : "gray"}>
            {label[proposal.status as keyof typeof label] ?? proposal.status}
          </Badge></p>
        <div className="flex justify-between"><span className="text-stone-500">Setuju {proposal.approvals} · Tolak {proposal.rejections}</span>
          <b>Butuh {proposal.quorum} dari {members.length}</b></div>
        <ProgressBar value={proposal.approvals} max={proposal.quorum} tone="bg-violet-800" />
        <p className="text-xs text-stone-500">Batas voting {dateTime(proposal.deadline)}.
          {proposal.myVote !== null && ` Suara Anda: ${proposal.myVote ? "setuju" : "tolak"}.`}
          {!proposal.chainProposalId && " Belum tercatat di chain."}</p>
      </>)}
      {canVote && open && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={a.busy} onClick={() => void a.run(() => api.voteProposal(open.id, true).then(() => "Suara setuju tercatat."))}>Setuju</Button>
          <Button variant="outline" disabled={a.busy} onClick={() => void a.run(() => api.voteProposal(open.id, false).then(() => "Suara tolak tercatat."))}>Tolak</Button>
        </div>
      )}
      {canPropose && cp && (
        <div className="space-y-1">
          <Button variant="outline" className="w-full" disabled={a.busy}
            onClick={() => { if (confirm(`Usulkan menutup periode ${cp.periodNo} dengan dana yang terkumpul (${paid} dari ${members.length} sudah bayar)?`)) void a.run(() => api.createCloseProposal(cp.id).then(() => "Usulan dibuat. Anggota bisa memberi suara."));}}>
            Usulkan tutup periode {cp.periodNo}
          </Button>
          <p className="text-xs text-stone-500">Perlu persetujuan {Math.floor(members.length / 2) + 1} dari {members.length} anggota (mayoritas mutlak).</p>
        </div>
      )}
      {a.error && <p className="text-sm text-red-700">{a.error}</p>}
      {a.ok && <p className="text-sm text-brand">{a.ok}</p>}
    </Card>
  );
}

/** Pencairan (simulasi sandbox) untuk pengelola, per periode yang sudah siap cair. */
export function PayoutPanel({ detail, onChanged }: { detail: CircleDetail; onChanged: () => void }) {
  const ready = detail.periods.filter((p: Period) => p.status === "ready_payout");
  const a = useAction(onChanged);
  if (!detail.isCreator || ready.length === 0) return null;
  const name = (id: number | null) => detail.members.find((m: MemberView) => m.memberId === id)?.name ?? "–";
  return (
    <Card className="space-y-3 text-sm">
      <h2 className="text-xl font-extrabold">Pencairan</h2>
      {ready.map((p: Period) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand pt-3 first:border-0 first:pt-0">
          <div><b>Periode {p.periodNo}</b><div className="text-xs text-stone-500">Penerima: {name(p.recipientMemberId)}</div></div>
          <Button disabled={a.busy}
            onClick={() => { if (confirm(`Cairkan periode ${p.periodNo} ke ${name(p.recipientMemberId)}? (simulasi sandbox)`)) void a.run(async () => {
              const r = await api.simulatePayout(p.id);
              return `Pencairan ${rupiah(r.amount)} dibuat (${r.mode}, ${r.status}).`;
            }); }}>Cairkan (simulasi)</Button>
        </div>
      ))}
      <p className="text-xs text-stone-500">Dana pencairan = iuran + penalti terkumpul, tanpa biaya admin. Hash referensinya dicatat ke contract oleh worker.</p>
      {a.error && <p className="text-sm text-red-700">{a.error}</p>}
      {a.ok && <p className="text-sm text-brand">{a.ok}</p>}
    </Card>
  );
}
