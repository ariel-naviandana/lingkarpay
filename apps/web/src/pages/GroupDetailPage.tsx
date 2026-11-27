import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { PayoutPanel, QuorumCard } from "../components/CircleActions";
import { PayoutAccountCard } from "../components/PayoutAccountCard";
import { ArrearsCard } from "../components/ArrearsCard";
import { PayoutDetail } from "../components/PayoutDetail";
import DraftActions from "../components/DraftActions";
import PayButton from "../components/PayButton";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Loading,
  Mono,
  Td,
  Th,
} from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import {
  circleStatus,
  dateTime,
  daysLate,
  formatYmd,
  periodStatus,
  rupiah,
  shortDate,
} from "../lib/format";
import type { MemberView, Period, Proposal } from "../types";

const CONTRACT =
  (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ||
  "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2";

// Shared fixed height so the members card and the schedule card match.
const PANEL_HEIGHT = "h-[28rem]";

async function load(id: number) {
  const [detail, history, proposals] = await Promise.all([
    api.circle(id),
    api.payments(id).catch(() => ({ payments: [], payouts: [] })),
    api.proposals(id).catch(() => ({ proposals: [] })),
  ]);
  return { detail, history, proposals: proposals.proposals };
}

function statusBadge(m: MemberView) {
  if (m.status === "invited") return <Badge tone="amber">Menunggu konfirmasi</Badge>;
  const p = m.currentPayment;
  if (!p) return <span className="text-stone-400">–</span>;
  if (p.status === "ANCHORED") return <Badge tone="green">Lunas</Badge>;
  if (p.paid) return <Badge tone="purple">Menunggu rantai</Badge>;
  if (p.status === "PENDING")
    return <Badge tone="gray">Menunggu pembayaran</Badge>;
  return <Badge tone="red">Belum bayar</Badge>;
}
const periodTone = (s: Period["status"]) =>
  s === "done"
    ? "green"
    : s === "running"
      ? "amber"
      : s === "ready_payout"
        ? "purple"
        : "gray";

export default function GroupDetailPage() {
  const id = Number(useParams().id);
  const { data, error, loading, reload } = useAsync(() => load(id), [id]);
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await reload();
    } finally {
      setSyncing(false);
    }
  }
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;

  const { detail, history, proposals } = data;
  const {
    circle,
    members,
    periods,
    currentPeriod: cp,
    isCreator,
    myMemberId,
  } = detail;
  const [statusText, statusTone] = circleStatus[circle.status] ?? [
    "–",
    "gray" as const,
  ];
  const me = members.find((m: MemberView) => m.isMe);
  const paidCount = members.filter(
    (m: MemberView) => m.currentPayment?.paid,
  ).length;
  const recipient = members.find(
    (m: MemberView) => m.memberId === cp?.recipientMemberId,
  );
  const late =
    !!cp &&
    cp.status === "running" &&
    daysLate(cp.dueDate) > 0 &&
    paidCount < members.length;
  const isReadyPayout = !!cp && cp.status === "ready_payout";
  const canPay =
    circle.status === "active" &&
    cp?.status === "running" &&
    !!me?.currentPayment &&
    !me.currentPayment.paid;
  const myPenalty = me?.currentPayment?.penaltyDue ?? 0;
  const myTotal = circle.contributionAmount + myPenalty + circle.adminFee;
  const proposal =
    proposals.find((p: Proposal) => p.status === "open") ?? proposals[0];
  const paidAt = (ref: string) =>
    history.payments.find(
      (p) => p.memberRef === ref && p.periodNo === cp?.periodNo && p.paidAt,
    )?.paidAt;
  const goPay = () =>
    document
      .getElementById("bayar")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1">
            <Link
              to="/dashboard"
              className="text-xs font-semibold text-stone-500 hover:text-brand transition"
            >
              ‹ Kembali ke dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {circle.name}
            </h1>
            {late ? (
              <Badge tone="amber">Ada yang terlambat</Badge>
            ) : isReadyPayout ? (
              <Badge tone="green">Siap cair</Badge>
            ) : (
              <Badge tone={statusTone}>{statusText}</Badge>
            )}
          </div>
          <p className="mt-1 text-xs sm:text-sm text-stone-500">
            Arisan bergilir · {circle.memberCount} anggota ·{" "}
            {cp
              ? `Periode ${cp.periodNo} dari ${periods.length}`
              : circle.status === "draft"
                ? `Belum dimulai · tanggal mulai ${formatYmd(circle.startDate)}`
                : "Semua periode selesai"}{" "}
            · {isCreator ? "Anda pengelola" : "Anda anggota"}
          </p>
        </div>
      </div>

      {canPay && cp && (
        <div
          id="bayar"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-amber-200 bg-amber-soft p-4 sm:p-5"
        >
          <div>
            <b className="text-amber-950 block">
              Iuran Periode {cp.periodNo} Anda ({me?.name}){" "}
              {daysLate(cp.dueDate) > 0
                ? `terlambat ${daysLate(cp.dueDate)} hari`
                : `jatuh tempo ${shortDate(cp.dueDate)}`}
            </b>
            <p className="mt-0.5 text-xs sm:text-sm text-amber-900">
              Total tagihan {rupiah(myTotal)} (Iuran{" "}
              {rupiah(circle.contributionAmount)} + Penalti {rupiah(myPenalty)}{" "}
              + Biaya admin {rupiah(circle.adminFee)}).
            </p>
          </div>
          <div className="shrink-0">
            <PayButton
              circleId={circle.id}
              periodId={cp.id}
              memberId={myMemberId ?? me?.memberId ?? 0}
              onPaid={reload}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4 sm:p-5">
          <p className="text-xs sm:text-sm text-stone-500">
            Target dana periode {cp?.periodNo ?? "–"}
          </p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {rupiah(circle.memberCount * circle.contributionAmount)}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {circle.memberCount} anggota × {rupiah(circle.contributionAmount)}, bila semua membayar
          </p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs sm:text-sm text-stone-500">
            Penerima periode ini
          </p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {recipient?.name ?? "–"}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {recipient && cp
              ? `Giliran #${recipient.turnOrder} · Tenggat ${shortDate(cp.dueDate)}`
              : "Belum ada periode berjalan"}
          </p>
        </Card>
        <Card className="p-4 sm:p-5 sm:col-span-2 lg:col-span-1">
          <p className="text-xs sm:text-sm text-stone-500">
            Progres iuran periode {cp?.periodNo ?? "–"}
          </p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {paidCount} dari {circle.memberCount}
          </p>
          <div className="mt-2 h-2 rounded-full bg-sand">
            <div
              className="h-2 rounded-full bg-brand"
              style={{
                width: `${circle.memberCount ? (paidCount / circle.memberCount) * 100 : 0}%`,
              }}
            />
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr] xl:grid-cols-[1.8fr_1.2fr]">
        {/* LEFT COLUMN: members -> (draft actions) -> group rules */}
        <div className="space-y-6">
          <Card className={`flex ${PANEL_HEIGHT} flex-col overflow-hidden`}>
            <div className="mb-4 shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold">
                  Daftar anggota & status iuran
                </h2>
                <p className="text-xs text-stone-500">
                  {cp
                    ? `Status pembayaran untuk Periode ${cp.periodNo} (jatuh tempo ${shortDate(cp.dueDate)})`
                    : "Kelompok belum memiliki periode berjalan"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={syncing}
                className="!px-3 !py-1.5 text-xs text-brand border-brand hover:bg-brand/10 shrink-0 self-start sm:self-auto"
                onClick={() => void handleSync()}
              >
                {syncing ? "Menyinkronkan..." : "Sinkronkan Status"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[540px] text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr>
                    <Th>Giliran</Th>
                    <Th>Nama</Th>
                    <Th>ID</Th>
                    <Th>Status</Th>
                    <Th>Penalti</Th>
                    <Th>Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: MemberView) => {
                    const when = paidAt(m.memberRef);
                    const penalty =
                      m.currentPayment && !m.currentPayment.paid
                        ? m.currentPayment.penaltyDue
                        : 0;
                    const mine =
                      m.isMe && !!m.currentPayment && !m.currentPayment.paid;
                    return (
                      <tr
                        key={m.memberId}
                        className={mine ? "bg-amber-50/60" : ""}
                      >
                        <Td>
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-sand text-xs font-bold">
                            {m.turnOrder ?? "–"}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-semibold block">
                            {m.name}
                            {m.isMe && " (Anda)"}
                          </span>
                          {when && (
                            <div className="text-xs text-stone-500">
                              Dibayar {dateTime(when)}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <Mono>{m.memberRef}</Mono>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {statusBadge(m)}
                            {(detail.arrears ?? []).some((a) => a.debtorMemberId === m.memberId && a.status === "open") && (
                              <Badge tone="red">Menunggak</Badge>
                            )}
                          </div>
                        </Td>
                        <Td>
                          {penalty > 0 ? (
                            <span className="font-semibold text-red-700">
                              {rupiah(penalty)}
                            </span>
                          ) : (
                            <span className="text-stone-400">–</span>
                          )}
                        </Td>
                        <Td>
                          {mine && canPay ? (
                            <Button
                              className="!px-3 !py-1 text-xs"
                              onClick={goPay}
                            >
                              Bayar
                            </Button>
                          ) : (
                            <span className="text-xs text-stone-400">–</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {isCreator && circle.status === "draft" && (
            <DraftActions data={detail} onChanged={reload} />
          )}

          <Card className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-extrabold">
                Aturan kelompok
              </h2>
              <Badge tone="purple">Smart Contract</Badge>
            </div>
            {(
              [
                ["Iuran per periode", rupiah(circle.contributionAmount)],
                ["Periode", `${circle.periodDays} hari`],
                ["Tanggal mulai", formatYmd(circle.startDate)],
                [
                  "Urutan giliran",
                  circle.status === "draft" ? "Diundi acak saat dikunci" : "Hasil undian acak sistem",
                ],
                ...(circle.drawSeed
                  ? ([["Seed undian", `${circle.drawSeed.slice(0, 10)}…${circle.drawSeed.slice(-4)}`]] as const)
                  : []),
                ["Penalti keterlambatan", circle.penaltyPct > 0 ? `${circle.penaltyPct}% dari iuran, sekali bila terlambat` : "Tidak ada"],
                ["Biaya admin", `${rupiah(circle.adminFee)} per pembayaran`],
                [
                  "Kuorum keputusan",
                  `${Math.floor(circle.memberCount / 2) + 1} dari ${circle.memberCount} anggota`,
                ],
                [
                  "ID kelompok di chain",
                  circle.chainCircleId ?? "belum tercatat",
                ],
                [
                  "Alamat contract",
                  `${CONTRACT.slice(0, 12)}…${CONTRACT.slice(-4)}`,
                ],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between gap-3 border-t border-sand pt-2.5 text-xs sm:text-sm"
              >
                <span className="text-stone-500">{k}</span>
                {k === "Alamat contract" || k === "Seed undian" ? (
                  <Mono>{v}</Mono>
                ) : (
                  <b className="text-right">{v}</b>
                )}
              </div>
            ))}
            <p className="text-xs text-stone-500">
              {circle.status === "draft"
                ? "Aturan terkunci setelah kelompok dimulai."
                : "Aturan sudah terkunci sejak kelompok dimulai."}{" "}
              Iuran, penalti, biaya admin, dan urutan giliran dicatat di contract; tanggal mulai dan seed undian disimpan
              server. Urutan = anggota diurutkan menurut SHA-256(seed:ID anggota), jadi siapa pun bisa menghitung ulang.
              Bila periode dibuka terlambat, tenggatnya di aplikasi digeser agar anggota tetap mendapat {circle.periodDays} hari.
            </p>
          </Card>
        </div>

        {/* RIGHT COLUMN: schedule -> payout -> quorum */}
        <div className="space-y-6">
          <Card className={`flex ${PANEL_HEIGHT} flex-col gap-3 overflow-hidden`}>
            <h2 className="shrink-0 text-lg sm:text-xl font-extrabold">
              Jadwal periode arisan
            </h2>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {periods.length === 0 && (
                <p className="text-xs text-stone-500">
                  Jadwal dibuat saat kelompok dimulai.
                </p>
              )}
              {periods.map((p: Period) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-2.5 sm:p-3 text-xs sm:text-sm ${p.id === cp?.id ? "border-brand bg-mint/40 font-semibold" : "border-sand bg-white"}`}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <span className="grid h-5 w-5 sm:h-6 sm:w-6 shrink-0 place-items-center rounded-full bg-sand text-xs font-bold">
                      {p.periodNo}
                    </span>
                    <div>
                      <div>
                        P{p.periodNo} · {shortDate(p.dueDate)}
                      </div>
                      <div className="text-xs text-stone-500">
                        Penerima:{" "}
                        {members.find(
                          (m: MemberView) => m.memberId === p.recipientMemberId,
                        )?.name ?? "–"}
                      </div>
                    </div>
                  </div>
                  <Badge tone={periodTone(p.status)}>
                    {periodStatus[p.status] ?? p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          <ArrearsCard arrears={detail.arrears ?? []} me={me} onChanged={reload} />
          {me && <PayoutAccountCard key={me.payoutAccount?.updatedAt ?? "none"} circleId={circle.id} me={me} onChanged={reload} />}
          <PayoutPanel detail={detail} payments={history.payments} onChanged={reload} />
          {history.payouts.length > 0 && (
            <Card className="space-y-3">
              <h2 className="text-lg sm:text-xl font-extrabold">Riwayat pencairan</h2>
              {[...history.payouts].reverse().map((po, i) => (
                <details key={po.id} open={i === 0} className="border-t border-sand pt-3 first:border-0 first:pt-0">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Periode {po.periodNo} · {rupiah(po.amount)} ke {po.recipientName ?? po.recipientMemberRef}
                  </summary>
                  <div className="mt-3"><PayoutDetail payout={po} /></div>
                </details>
              ))}
            </Card>
          )}
          <QuorumCard detail={detail} proposal={proposal} onChanged={reload} />
        </div>
      </div>
    </div>
  );
}