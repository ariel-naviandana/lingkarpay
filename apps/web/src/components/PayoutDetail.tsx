import type { ReactNode } from "react";
import { Badge, Mono } from "./ui";
import { dateTime, etherscanTx, rupiah, shortHash } from "../lib/format";
import type { CirclePayoutItem } from "../types";

interface Step {
  title: string;
  desc: ReactNode;
  time?: string | null;
  state: "done" | "pending" | "failed";
}

const isSim = (p: CirclePayoutItem) => p.mode.toLowerCase() === "simulated";

function buildSteps(p: CirclePayoutItem): Step[] {
  const contrib = p.contributionTotal ?? 0;
  const penalty = p.penaltyTotal ?? 0;
  const failed = p.status === "FAILED";

  // 5. Pengiriman ke penerima
  let send: Step;
  if (isSim(p)) {
    send = {
      title: "Dikirim ke penerima",
      desc: (
        <>
          Simulasi sandbox: <b>{rupiah(p.amount)}</b> untuk {p.recipientName ?? p.recipientMemberRef} dicatat sebagai
          terkirim, tidak ada uang yang benar-benar bergerak. Pada produksi, dana dikirim lewat Midtrans Iris ke rekening penerima.
        </>
      ),
      time: p.updatedAt ?? p.createdAt,
      state: "done",
    };
  } else {
    const label: Record<string, string> = {
      QUEUED: "Menunggu persetujuan di Iris",
      APPROVED: "Disetujui, dikirim ke rekening penerima",
      COMPLETED: "Dana diterima di rekening penerima",
      FAILED: "Gagal di Iris, bisa dicoba lagi",
    };
    send = {
      title: "Dikirim ke penerima",
      desc: (
        <>
          <b>{rupiah(p.amount)}</b> untuk {p.recipientName ?? p.recipientMemberRef}: {label[p.status] ?? p.status}.
          {p.irisReferenceNo && <> Referensi Iris <Mono>{p.irisReferenceNo}</Mono>.</>}
          {p.recipientAccountHash && <> Rekening tujuan hanya disimpan sebagai hash.</>}
        </>
      ),
      time: p.updatedAt ?? p.createdAt,
      state: failed ? "failed" : p.status === "QUEUED" ? "pending" : "done",
    };
  }

  // 6. Pencatatan di contract
  const chain = p.chainStatus ?? "queued";
  const chainDesc: ReactNode =
    chain === "confirmed" ? (
      <>
        markPayout tercatat di Sepolia
        {p.txHash && (
          <>
            {" "}
            · tx{" "}
            <a href={etherscanTx(p.txHash)} target="_blank" rel="noreferrer" className="underline">
              <Mono>{shortHash(p.txHash)}</Mono>
            </a>
          </>
        )}
      </>
    ) : chain === "failed" ? (
      "Pencatatan gagal; worker akan mencoba lagi."
    ) : chain === "sent" ? (
      "Transaksi terkirim, menunggu konfirmasi blok."
    ) : (
      "Menunggu worker mencatat hash referensi pencairan ke contract."
    );

  return [
    {
      title: "Iuran terkumpul",
      desc: (
        <>
          {p.paidCount ?? "–"} dari {p.memberCount ?? "–"} anggota lunas: iuran {rupiah(contrib)}
          {penalty > 0 && <> + penalti {rupiah(penalty)}</>}.
        </>
      ),
      time: p.lastPaidAt,
      state: "done",
    },
    {
      title: "Periode ditutup",
      desc:
        p.closedBy === "quorum" ? (
          <>
            Ditutup lewat kuorum: {p.approveVotes ?? 0} suara setuju (minimal {p.quorumNeeded ?? "–"}).
            {(p.paidCount ?? 0) < (p.memberCount ?? 0) && " Anggota yang belum bayar tidak ikut dicairkan."}
          </>
        ) : (
          "Semua iuran lunas, periode siap cair."
        ),
      time: p.closedAt,
      state: "done",
    },
    {
      title: "Penerima ditetapkan",
      desc: (
        <>
          {p.recipientName ?? p.recipientMemberRef} (<Mono>{p.recipientMemberRef}</Mono>), sesuai urutan giliran terkunci.
        </>
      ),
      state: "done",
    },
    {
      title: "Pencairan dibuat",
      desc: (
        <>
          Nominal <b>{rupiah(p.amount)}</b> = iuran + penalti terkumpul.
          {(p.adminFeeTotal ?? 0) > 0 && <> Biaya admin {rupiah(p.adminFeeTotal ?? 0)} adalah pendapatan platform dan tidak ikut dicairkan.</>}
        </>
      ),
      time: p.createdAt,
      state: "done",
    },
    send,
    {
      title: "Dicatat di smart contract",
      desc: chainDesc,
      time: p.chainConfirmedAt,
      state: chain === "confirmed" ? "done" : chain === "failed" ? "failed" : "pending",
    },
  ];
}

const dot = {
  done: "bg-brand text-white",
  pending: "border-2 border-violet-800 text-violet-800",
  failed: "bg-red-600 text-white",
} as const;

/** Rincian satu pencairan: kepada siapa, berapa, dari mana dananya, dan tiap langkahnya. */
export function PayoutDetail({ payout: p, title }: { payout: CirclePayoutItem; title?: string }) {
  const steps = buildSteps(p);
  const contributors = p.contributors ?? [];
  return (
    <div className="space-y-4 text-sm">
      <div>
        {title && <h2 className="text-lg sm:text-xl font-extrabold">{title} · Periode {p.periodNo}</h2>}
        <p className="text-xs sm:text-sm text-stone-500">
          {isSim(p) ? "Mode simulasi sandbox" : "Midtrans Iris (sandbox)"}
        </p>
      </div>

      <div className="grid gap-2 rounded-xl bg-mint p-3 sm:p-4 text-xs sm:text-sm text-brand">
        <div className="flex justify-between gap-3">
          <span>Dikirim ke</span>
          <b className="text-right">{p.recipientName ?? p.recipientMemberRef} <Mono>{p.recipientMemberRef}</Mono></b>
        </div>
        <div className="flex justify-between gap-3">
          <span>Nominal</span>
          <b>{rupiah(p.amount)}</b>
        </div>
        <div className="flex justify-between gap-3">
          <span>Rincian</span>
          <span className="text-right">
            iuran {rupiah(p.contributionTotal ?? 0)}
            {(p.penaltyTotal ?? 0) > 0 && <> + penalti {rupiah(p.penaltyTotal ?? 0)}</>}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Rekening tujuan</span>
          <span className="text-right">
            {isSim(p) ? "Tidak ada (simulasi)" : p.recipientAccountHash ? <>hash <Mono>{shortHash(p.recipientAccountHash)}</Mono></> : "–"}
          </span>
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${dot[s.state]}`}>
              {s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2">
                <b className="text-xs sm:text-sm">{s.title}</b>
                {s.time && <span className="text-[11px] text-stone-400">{dateTime(s.time)}</span>}
              </div>
              <p className="text-xs text-stone-500">{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>

      {contributors.length > 0 && (
        <details className="rounded-xl border border-sand p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Siapa saja yang iurannya dicairkan ({contributors.length})</summary>
          <ul className="mt-2 space-y-1">
            {contributors.map((c) => (
              <li key={c.memberRef} className="flex justify-between gap-3">
                <span>{c.name} <Mono>{c.memberRef}</Mono></span>
                <span>{rupiah(c.amount + c.penaltyAmount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="rounded-xl bg-cream p-3 sm:p-4 text-xs text-stone-600">
        Yang disimpan di contract hanya hash referensi pencairan, bukan nama atau nomor rekening.
        <div className="mt-1 break-all"><Mono>payoutRefHash: {shortHash(p.payoutRefHash)}</Mono></div>
      </div>
    </div>
  );
}

export function PayoutBadge({ status }: { status: string }) {
  const label: Record<string, string> = { SIMULATED: "Disimulasikan", QUEUED: "Dalam antrean", APPROVED: "Disetujui", COMPLETED: "Selesai", FAILED: "Gagal" };
  return <Badge tone={status === "FAILED" ? "red" : status === "COMPLETED" ? "green" : "purple"}>{label[status] ?? status}</Badge>;
}
