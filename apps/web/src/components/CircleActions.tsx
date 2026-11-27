import { useEffect, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { api, ApiError } from "../api";
import { PAID_STATUSES, type CircleDetail, type CirclePaymentItem, type MemberView, type Period, type Proposal } from "../types";
import { accountLabel, dateTime, rupiah, shortDate } from "../lib/format";
import { Badge, Button, Card, ProgressBar } from "./ui";

const ERR: Record<string, string> = {
  PROPOSAL_EXISTS: "Sudah ada usulan terbuka untuk periode ini.",
  PERIOD_COMPLETE: "Semua iuran periode ini sudah lunas, tidak perlu usulan.",
  PERIOD_NOT_OPEN: "Periode ini tidak sedang berjalan.",
  NOT_DUE_YET: "Periode belum lewat jatuh tempo. Anggota masih punya waktu membayar.",
  ALREADY_VOTED: "Anda sudah memberi suara.",
  VOTING_CLOSED: "Batas waktu voting sudah lewat.",
  PROPOSAL_NOT_OPEN: "Usulan ini sudah tidak terbuka.",
  PERIOD_NOT_READY: "Periode belum siap cair.",
  PAYOUT_EXISTS: "Pencairan periode ini sudah dibuat.",
  PAYOUT_ACCOUNT_REQUIRED: "Penerima belum mengisi rekening pencairan. Minta penerima mengisinya di halaman kelompok ini.",
  CHAIN_ALREADY_PAID_OUT: "Contract mencatat periode ini sudah dicairkan. Muat ulang halaman.",
  CHAIN_RECIPIENT_MISMATCH: "Penerima menurut contract berbeda dengan data server. Pencairan dihentikan; periksa log worker chain.",
  CHAIN_UNAVAILABLE: "Contract di Sepolia tidak dapat dibaca saat ini. Pencairan ditunda; coba lagi beberapa saat lagi.",
};
const msg = (e: unknown) => {
  if (e instanceof ApiError) {
    if (ERR[e.code]) return ERR[e.code]!;
    if (e.status === 0 || e.status >= 500) return "Server tidak dapat dihubungi saat ini. Pastikan backend API sudah berjalan.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Gagal";
};

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [ok, setOk] = useState("");
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(""); setCode(""); setOk("");
    try { setOk((await fn()) ?? ""); onDone(); }
    catch (e) { setError(msg(e)); setCode(e instanceof ApiError ? e.code : ""); }
    finally { setBusy(false); }
  };
  return { busy, error, code, ok, run };
}

const label = { open: "Terbuka", rejected: "Ditolak", expired: "Kedaluwarsa", executed: "Disetujui" } as const;

/** Kartu kuorum: lihat usulan, usulkan tutup periode, dan beri suara. */
export function QuorumCard({ detail, proposal, onChanged }: { detail: CircleDetail; proposal?: Proposal; onChanged: () => void }) {
  const { circle, members, currentPeriod: cp } = detail;
  // Waktu acuan diperbarui berkala dan setelah setiap aksi, agar status jatuh tempo tidak basi.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const a = useAction(() => { setNow(Date.now()); onChanged(); });
  const paid = members.filter((m: MemberView) => m.currentPayment?.paid).length;
  const open = proposal?.status === "open" ? proposal : undefined;
  const { data: cfg } = useAsync(() => api.publicConfig(), []);
  const running = circle.status === "active" && cp?.status === "running";
  const overdue = !!cp && new Date(cp.dueDate).getTime() <= now;
  // Penutupan darurat hanya untuk periode yang sudah lewat jatuh tempo (aturan yang sama dicek server).
  const canPropose = running && overdue && paid > 0 && paid < members.length && !open;
  const waitingDue = running && !overdue && paid < members.length && !open;
  const canVote = !!open && open.myVote === null && new Date(open.deadline).getTime() > now;

  return (
    <Card className="space-y-3 text-sm">
      <h2 className="text-xl font-extrabold">Keputusan kuorum</h2>
      {!proposal ? (
        <p className="text-stone-500">
          {waitingDue && cp
            ? `Belum ada usulan. Usulan tutup periode baru bisa dibuat setelah jatuh tempo ${shortDate(cp.dueDate)} lewat dan masih ada yang belum bayar.`
            : running && paid === 0
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
      {cfg?.devTools && waitingDue && cp && (
        <div className="space-y-1 rounded-xl border border-dashed border-amber-300 bg-amber-soft/60 p-3">
          <Button variant="outline" className="w-full" disabled={a.busy}
            onClick={() => { if (confirm(`Mode sandbox: jadikan periode ${cp.periodNo} sudah lewat jatuh tempo? Hanya untuk demo; tidak tersedia di produksi.`)) void a.run(() => api.devMakeOverdue(cp.id).then(() => "Simulasi: periode kini lewat jatuh tempo."));}}>
            Simulasi: lewati jatuh tempo
          </Button>
          <p className="text-xs text-amber-900">Alat demo sandbox (DEV_TOOLS). Menggeser tenggat di database agar alur kuorum bisa dicoba tanpa menunggu.</p>
        </div>
      )}
      {a.error && <p className="text-sm text-red-700">{a.error}</p>}
      {a.ok && <p className="text-sm text-brand">{a.ok}</p>}
    </Card>
  );
}

/** Pencairan (simulasi sandbox), per periode siap cair: oleh pengelola, atau oleh penerima giliran itu sendiri. */
export function PayoutPanel({ detail, payments = [], onChanged }: { detail: CircleDetail; payments?: CirclePaymentItem[]; onChanged: () => void }) {
  const ready = detail.periods.filter(
    (p: Period) => p.status === "ready_payout" && (detail.isCreator || p.recipientMemberId === detail.myMemberId),
  );
  const a = useAction(onChanged);
  if (ready.length === 0) return null;
  const name = (id: number | null) => detail.members.find((m: MemberView) => m.memberId === id)?.name ?? "–";
  const account = (id: number | null) => detail.members.find((m: MemberView) => m.memberId === id)?.payoutAccount ?? null;
  // Perkiraan nominal: iuran + penalti dari pembayaran lunas periode itu (angka final dihitung server).
  // Iuran periode itu saja; pelunasan tunggakan diteruskan terpisah ke penerima periode lamanya.
  const periodPaid = (periodNo: number) =>
    payments.filter((x) => x.periodNo === periodNo && PAID_STATUSES.includes(x.status) && !x.isArrearsPayment);
  const gross = (periodNo: number) => periodPaid(periodNo).reduce((sum, x) => sum + x.amount + x.penaltyAmount, 0);
  const paidCount = (periodNo: number) => periodPaid(periodNo).length;
  // Tunggakan penerima yang akan dipotong (perkiraan; angka final dihitung server).
  const debts = (memberId: number | null) =>
    (detail.arrears ?? []).filter((x) => x.debtorMemberId === memberId && x.status === "open");
  const estimate = (p: Period) => {
    let left = gross(p.periodNo);
    for (const d of debts(p.recipientMemberId)) if (left - d.totalDue >= 1) left -= d.totalDue;
    return left;
  };
  const payout = (p: Period) =>
    a.run(async () => {
      const r = await api.simulatePayout(p.id);
      const to = r.destination ? ` ke ${accountLabel(r.destination)}` : "";
      return `Transfer simulasi ${rupiah(r.amount)}${to} tercatat${r.transferRef ? `, ref ${r.transferRef}` : ""}.`;
    });
  const waitingChain = a.code === "CHAIN_NOT_READY";
  return (
    <Card className="space-y-3 text-sm">
      <h2 className="text-xl font-extrabold">Pencairan</h2>
      {ready.map((p: Period) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand pt-3 first:border-0 first:pt-0">
          <div>
            <b>Periode {p.periodNo}</b>
            <div className="text-xs text-stone-500">Penerima: {name(p.recipientMemberId)}</div>
            <div className="text-xs text-stone-500">
              Tujuan transfer:{" "}
              {account(p.recipientMemberId) ? (
                <b className="text-ink">{accountLabel(account(p.recipientMemberId)!)}</b>
              ) : (
                <span className="text-red-700">rekening belum diisi penerima</span>
              )}
            </div>
            <div className="text-xs text-stone-500">Terkumpul: {rupiah(gross(p.periodNo))} · {paidCount(p.periodNo)} dari {detail.members.length} iuran lunas</div>
            {debts(p.recipientMemberId).length > 0 && (
              <div className="text-xs text-red-700">
                Dipotong tunggakan penerima: {rupiah(gross(p.periodNo) - estimate(p))} (diteruskan ke{" "}
                {[...new Set(debts(p.recipientMemberId).map((d) => d.creditorName))].join(", ")})
              </div>
            )}
            <div className="text-xs text-stone-500">Dikirim: <b className="text-ink">{rupiah(estimate(p))}</b></div>
          </div>
          <Button disabled={a.busy || !account(p.recipientMemberId)}
            onClick={() => {
              const acct = account(p.recipientMemberId);
              if (acct && confirm(`Transfer ${rupiah(estimate(p))} (periode ${p.periodNo}) ke ${accountLabel(acct)}?\n\nIni simulasi sandbox: tidak ada uang yang bergerak.`)) void payout(p);
            }}>
            {waitingChain ? "Coba lagi" : "Cairkan (simulasi)"}
          </Button>
        </div>
      ))}
      {!detail.isCreator && <p className="text-xs text-stone-500">Ini giliran Anda. Anda bisa mencairkannya sendiri tanpa menunggu pengelola.</p>}
      <p className="text-xs text-stone-500">Dana pencairan = iuran + penalti terkumpul, tanpa biaya admin. Sebelum dana dicairkan, server memeriksa bahwa smart contract juga menyatakan periode siap cair dengan penerima yang sama; hash pencairan lalu dicatat ke contract oleh worker.</p>
      {waitingChain && (
        <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber-900 space-y-1">
          <b>Menunggu smart contract</b>
          <p>{a.error}</p>
          <p>Pencatatan di Sepolia butuh sekitar 12 detik per transaksi. Pastikan worker chain berjalan, lalu tekan Coba lagi.</p>
        </div>
      )}
      {a.error && !waitingChain && <p className="text-sm text-red-700">{a.error}</p>}
      {a.ok && <p className="text-sm text-brand">{a.ok}</p>}
    </Card>
  );
}
