import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card } from "../components/ui";
import { InvitationsCard } from "../components/InvitationsCard";
import { useAuth } from "../context/useAuth";
import { api } from "../api";
import { formatDateTime, formatYmd, orderLabel, rupiah } from "../lib/format";
import type { Circle, CircleDetail, CirclePaymentItem, CirclePayoutItem } from "../types";

interface UnpaidAlert {
  circleId: number;
  circleName: string;
  periodNo: number;
  /** true = tunggakan periode lama yang sudah ditutup kuorum. */
  arrears?: boolean;
  /** true = setoran dana jaminan kelompok draft. */
  deposit?: boolean;
  contributionAmount: number;
  penaltyDue: number;
  adminFee: number;
  totalGross: number;
}

interface ActivityItem {
  id: string;
  tone: "green" | "amber" | "purple" | "gray";
  badge: string;
  message: string;
  time: string;
  ts: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [circleDetails, setCircleDetails] = useState<Record<number, CircleDetail>>({});
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.circles();
      const circleList = res.circles || [];
      setCircles(circleList);

      // Fetch details and payments for each circle
      const detailsMap: Record<number, CircleDetail> = {};
      const allActivities: ActivityItem[] = [];

      await Promise.all(
        circleList.map(async (c) => {
          try {
            const detail = await api.circle(c.id).catch(() => null);
            if (detail) {
              detailsMap[c.id] = detail;
            }

            // Fetch circle payments
            const payRes = await api.payments(c.id).catch(() => null);
            if (payRes) {
              const payments: CirclePaymentItem[] = payRes.payments || [];
              const payouts: CirclePayoutItem[] = payRes.payouts || [];

              for (const p of payments) {
                const settled = ["SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED"].includes(p.status);
                const [label, labelTone] =
                  p.isDeposit && settled
                    ? (["Jaminan diterima", "green"] as const)
                    : p.isArrearsPayment && settled
                    ? (["Lunas · tunggakan diteruskan", "green"] as const)
                    : orderLabel(p.status);
                const at = p.paidAt || p.createdAt;
                allActivities.push({
                  id: `pay-${p.orderId}`,
                  tone: labelTone === "red" ? "gray" : labelTone,
                  badge: label,
                  message: p.isDeposit
                    ? `Dana jaminan ${p.memberName} · ${c.name} · ${rupiah(p.grossAmount)}`
                    : `${p.isArrearsPayment ? "Pelunasan tunggakan" : "Iuran"} ${p.memberName} periode ${p.periodNo} · ${c.name} · ${rupiah(p.grossAmount)}`,
                  time: formatDateTime(at),
                  ts: new Date(at).getTime(),
                });
              }

              for (const po of payouts) {
                allActivities.push({
                  id: `payout-${po.id}`,
                  tone: "green",
                  badge: "Pencairan",
                  message: `Pencairan periode ${po.periodNo} · ${c.name} · ${rupiah(po.amount)}${po.destination ? ` ke ${po.destination.channelLabel} ••••${po.destination.last4}` : ""}`,
                  time: formatDateTime(po.createdAt),
                  ts: new Date(po.createdAt).getTime(),
                });
              }
            }
          } catch {
            // Circle detail failed or not available yet
          }
        })
      );

      setCircleDetails(detailsMap);
      setActivities(allActivities.sort((a, b) => b.ts - a.ts));
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memuat data dari server. Pastikan backend API berjalan."
      );
      setCircles([]);
      setCircleDetails({});
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Compute stats
  const activeCircles = circles.filter((c) => c.status === "active");
  const draftCircles = circles.filter((c) => c.status === "draft");

  // Check unpaid bills for user
  const unpaidAlerts: UnpaidAlert[] = [];
  let nextTurnText = "Belum ada giliran aktif";
  let nextTurnSub = "–";
  let nextTurnDue = Infinity;

  for (const c of circles) {
    const detail = circleDetails[c.id];
    if (!detail) continue;

    const myMember = detail.members.find((m) => m.isMe);
    if (
      c.status === "active" &&
      detail.currentPeriod &&
      detail.currentPeriod.status === "running" &&
      myMember?.currentPayment &&
      !myMember.currentPayment.paid
    ) {
      const pDue = myMember.currentPayment.penaltyDue || 0;
      const fee = c.adminFee || 0;
      const gross = c.contributionAmount + pDue + fee;
      unpaidAlerts.push({
        circleId: c.id,
        circleName: c.name,
        periodNo: detail.currentPeriod.periodNo,
        contributionAmount: c.contributionAmount,
        penaltyDue: pDue,
        adminFee: fee,
        totalGross: gross,
      });
    }

    // Jaminan saya yang belum disetor di kelompok draft.
    if (
      c.status === "draft" &&
      (c.depositAmount ?? 0) > 0 &&
      !(detail.deposits ?? []).some((d) => d.memberId === detail.myMemberId)
    ) {
      unpaidAlerts.push({
        circleId: c.id,
        circleName: c.name,
        periodNo: 0,
        deposit: true,
        contributionAmount: c.depositAmount!,
        penaltyDue: 0,
        adminFee: 0,
        totalGross: c.depositAmount!,
      });
    }

    // Tunggakan saya yang belum lunas (iuran + penalti + biaya admin saat dilunasi).
    for (const a of detail.arrears ?? []) {
      if (a.status !== "open" || a.debtorMemberId !== detail.myMemberId) continue;
      unpaidAlerts.push({
        circleId: c.id,
        circleName: c.name,
        periodNo: a.periodNo,
        arrears: true,
        contributionAmount: a.amount,
        penaltyDue: a.penaltyAmount,
        adminFee: c.adminFee || 0,
        totalGross: a.totalDue + (c.adminFee || 0),
      });
    }

    // Giliran saya berikutnya: yang paling dekat jatuh tempo di semua kelompok.
    const myPeriod = detail.periods?.find((p) => p.recipientMemberId === detail.myMemberId);
    if (myPeriod && myPeriod.status !== "done") {
      const due = new Date(myPeriod.dueDate).getTime();
      if (due < nextTurnDue) {
        nextTurnDue = due;
        nextTurnText = myPeriod.status === "ready_payout" ? `Siap cair (periode ${myPeriod.periodNo})` : `Periode ${myPeriod.periodNo}`;
        nextTurnSub = `${c.name} · target ${rupiah(c.contributionAmount * c.memberCount)} · ${formatDateTime(myPeriod.dueDate)}`;
      }
    }
  }

  const totalUnpaid = unpaidAlerts.reduce((acc, a) => acc + a.totalGross, 0);

  const [todayStr] = useState(() =>
    new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Halo, {user?.name || "Pengguna"}
          </h1>
          <p className="text-sm text-stone-500">{todayStr}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void loadData()}
            disabled={loading}
            className="w-full sm:w-auto text-xs"
          >
            {loading ? "Menyegarkan..." : "↻ Segarkan"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" onClick={() => void loadData()} className="text-xs !py-1">
            Coba lagi
          </Button>
        </div>
      )}

      <InvitationsCard onChanged={() => void loadData()} />

      {/* Unpaid Warning Banner */}
      {unpaidAlerts.length > 0 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-amber-200 bg-amber-soft p-4 sm:p-5">
          <div>
            <b className="text-amber-950 block">
              {unpaidAlerts[0].deposit
                ? `Dana jaminan ${unpaidAlerts[0].circleName} menunggu disetor`
                : `${unpaidAlerts[0].arrears ? "Tunggakan" : "Iuran"} ${unpaidAlerts[0].circleName} Periode ${unpaidAlerts[0].periodNo} menunggu pembayaran`}
              {unpaidAlerts.length > 1 && ` (+${unpaidAlerts.length - 1} tagihan lain)`}
            </b>
            <p className="mt-1 text-sm text-amber-900">
              {unpaidAlerts[0].deposit ? (
                <>Jaminan {rupiah(unpaidAlerts[0].totalGross)} tanpa biaya admin, dikembalikan saat kelompok selesai.</>
              ) : (
                <>
              Total tagihan {rupiah(unpaidAlerts[0].totalGross)}: iuran {rupiah(unpaidAlerts[0].contributionAmount)}
              {unpaidAlerts[0].penaltyDue > 0 && `, penalti ${rupiah(unpaidAlerts[0].penaltyDue)}`}
              {unpaidAlerts[0].adminFee > 0 && `, biaya admin ${rupiah(unpaidAlerts[0].adminFee)}`}.
                </>
              )}
            </p>
          </div>
          <Link
            to={unpaidAlerts[0].arrears || unpaidAlerts[0].deposit ? `/groups/${unpaidAlerts[0].circleId}` : `/groups/${unpaidAlerts[0].circleId}/pay`}
            className="shrink-0"
          >
            <Button className="w-full sm:w-auto">Bayar sekarang</Button>
          </Link>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-stone-500">Tagihan aktif</p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {totalUnpaid > 0 ? rupiah(totalUnpaid) : "Rp0"}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {unpaidAlerts.length > 0
              ? `${unpaidAlerts.length} tagihan menunggu pembayaran`
              : "Semua iuran periode berjalan lunas"}
          </p>
        </Card>

        <Card className="p-4 sm:p-5">
          <p className="text-sm text-stone-500">Kelompok terdaftar</p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {circles.length}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">
            {activeCircles.length} aktif, {draftCircles.length} belum dimulai
          </p>
        </Card>

        <Card className="p-4 sm:p-5">
          <p className="text-sm text-stone-500">Giliran saya berikutnya</p>
          <p className="my-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {nextTurnText}
          </p>
          <p className="text-xs sm:text-sm text-stone-500">{nextTurnSub}</p>
        </Card>
      </div>

      {/* Kelompok Saya */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Kelompok saya</h2>
          <span className="text-xs text-stone-500">{circles.length} kelompok terdaftar</span>
        </div>

        {circles.length === 0 && !loading && (
          <Card className="p-8 text-center space-y-3">
            <p className="text-stone-500">Anda belum tergabung dalam kelompok arisan.</p>
            <Link to="/groups/new">
              <Button>+ Buat kelompok baru</Button>
            </Link>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {circles.map((c) => {
            const detail = circleDetails[c.id];
            const isCreator = detail?.isCreator ?? (Number(c.createdBy) === Number(user?.id));
            const currentPeriodNo = detail?.currentPeriod?.periodNo ?? 1;

            let badgeTone: "green" | "amber" | "gray" | "purple" | "red" = "gray";
            let badgeText = "Belum dimulai";

            if (c.status === "active") {
              const hasOverdue = detail?.members.some(
                (m) => m.currentPayment && !m.currentPayment.paid && m.currentPayment.penaltyDue > 0
              );
              if (hasOverdue) {
                badgeTone = "amber";
                badgeText = "Ada yang terlambat";
              } else {
                badgeTone = "green";
                badgeText = "Berjalan";
              }
            } else if (c.status === "completed") {
              badgeTone = "purple";
              badgeText = "Selesai";
            } else if (c.status === "cancelled") {
              badgeTone = "red";
              badgeText = "Dibatalkan";
            }

            const cpStatus = detail?.currentPeriod?.status;
            const paidCount =
              cpStatus === "ready_payout"
                ? c.memberCount
                : detail?.members.filter((m) => m.currentPayment?.paid).length ?? 0;
            const totalCount = c.memberCount || 1;
            const pct = Math.min(100, Math.round((paidCount / totalCount) * 100));

            return (
              <Link key={c.id} to={`/groups/${c.id}`}>
                <Card className="h-full space-y-3 p-4 sm:p-5 hover:border-brand transition">
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-base sm:text-lg leading-tight">{c.name}</b>
                    <Badge tone={badgeTone}>{badgeText}</Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-stone-500">
                    {isCreator ? "Pengelola" : "Anggota"} · {c.memberCount} orang · {rupiah(c.contributionAmount)} per {c.periodDays} hari
                  </p>
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-stone-500">
                      {c.status === "active"
                        ? `Periode ${currentPeriodNo} dari ${c.memberCount}`
                        : c.status === "completed"
                        ? `${c.memberCount} periode selesai`
                        : c.status === "cancelled"
                        ? "Dibatalkan sebelum dimulai"
                        : "Menunggu anggota bergabung"}
                    </span>
                    <b>
                      {c.status === "active"
                        ? cpStatus === "ready_payout"
                          ? "Siap cair"
                          : `${paidCount} dari ${c.memberCount} sudah bayar`
                        : c.status === "completed"
                        ? "Selesai"
                        : c.status === "cancelled"
                        ? "–"
                        : `${c.joinedCount ?? 1} dari ${c.memberCount} bergabung`}
                    </b>
                  </div>
                  <div className="h-2 rounded-full bg-sand">
                    <div
                      className="h-2 rounded-full bg-brand"
                      style={{
                        width: `${c.status === "completed" ? 100 : c.status === "active" ? pct : ((c.joinedCount ?? 1) / totalCount) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-stone-500">
                    {c.status === "active"
                      ? c.chainCircleId
                        ? `Tercatat on-chain Sepolia (#${c.chainCircleId})`
                        : "Menunggu sinkronisasi Sepolia"
                      : c.status === "completed"
                      ? c.chainCircleId
                        ? `Selesai · tercatat on-chain Sepolia (#${c.chainCircleId})`
                        : "Selesai"
                      : c.status === "cancelled"
                      ? "Jaminan yang sudah disetor dikembalikan"
                      : `Mulai paling cepat ${c.startDate ? formatYmd(c.startDate) : "–"}, setelah semua anggota bergabung dan menyetor jaminan`}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Aktivitas Terbaru */}
      <Card>
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-extrabold">Aktivitas terbaru</h2>
          <Link to="/history" className="text-xs sm:text-sm font-semibold text-brand underline">
            Lihat semua riwayat
          </Link>
        </div>
        {activities.length === 0 ? (
          <p className="text-xs sm:text-sm text-stone-500 py-3">Belum ada aktivitas transaksi.</p>
        ) : (
          <div className="divide-y divide-sand">
            {activities.slice(0, 5).map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="shrink-0">
                  <Badge tone={a.tone}>{a.badge}</Badge>
                </div>
                <span className="flex-1 text-xs sm:text-sm">{a.message}</span>
                <span className="text-xs text-stone-500 shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
