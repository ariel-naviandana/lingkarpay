import { api } from "../api";
import { accountLabel, dateTime, rupiah } from "../lib/format";
import type { Arrear, MemberView } from "../types";
import PayButton from "./PayButton";
import { Badge, Card, Mono } from "./ui";

const label: Record<Arrear["status"], [string, "red" | "green" | "purple"]> = {
  open: ["Belum lunas", "red"],
  paid: ["Lunas (bayar susulan)", "green"],
  deducted: ["Lunas (dipotong dari jatah)", "purple"],
  covered: ["Lunas (ditutup dari jaminan)", "purple"],
};

/**
 * Tunggakan kelompok: iuran yang tidak dibayar saat periode ditutup kuorum. Terbuka untuk semua anggota.
 * Penunggak bisa melunasi sendiri; bila belum, tunggakan dipotong dari jatahnya saat gilirannya.
 */
export function ArrearsCard({
  arrears,
  me,
  myTurnPassed = false,
  onChanged,
}: {
  arrears: Arrear[];
  me?: MemberView;
  /** Giliran saya sudah dicairkan: tunggakan tidak bisa lagi dipotong dari jatah. */
  myTurnPassed?: boolean;
  onChanged: () => void;
}) {
  if (arrears.length === 0) return null;
  return (
    <Card className="space-y-3 text-sm">
      <div>
        <h2 className="text-lg sm:text-xl font-extrabold">Tunggakan</h2>
        <p className="text-xs text-stone-500">
          Iuran yang tidak dibayar saat periode ditutup lewat kuorum. Penunggak bisa melunasinya kapan saja; bila belum
          lunas saat gilirannya, tunggakan (iuran + penalti) dipotong dari jatahnya; bila gilirannya sudah lewat, ditutup dari
          dana jaminannya. Setiap pelunasan diteruskan ke penerima periode itu.
        </p>
      </div>
      {arrears.map((a) => {
        const mine = me?.memberId === a.debtorMemberId;
        const [text, tone] = label[a.status];
        return (
          <div key={a.id} className="space-y-2 border-t border-sand pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <b>
                  {a.debtorName}
                  {mine && " (Anda)"}
                </b>{" "}
                <span className="text-stone-500">→ {a.creditorName}, periode {a.periodNo}</span>
              </div>
              <Badge tone={tone}>{text}</Badge>
            </div>
            <div className="text-xs text-stone-500">
              Iuran {rupiah(a.amount)} + penalti {rupiah(a.penaltyAmount)} = <b className="text-ink">{rupiah(a.totalDue)}</b>
              {a.status === "deducted" && a.settledPayoutPeriodNo && <> · dipotong dari pencairan periode {a.settledPayoutPeriodNo}</>}
              {a.settledAt && <> · {dateTime(a.settledAt)}</>}
            </div>
            {a.forward && (
              <div className="rounded-xl bg-mint p-2.5 text-xs text-brand">
                Diteruskan ke {a.creditorName}: <b>{rupiah(a.forward.amount)}</b>
                {a.forward.destination && <> ke <b>{accountLabel(a.forward.destination)}</b></>}
                {a.forward.transferRef && <>, ref <Mono>{a.forward.transferRef}</Mono></>} (transfer simulasi)
              </div>
            )}
            {mine && a.status === "open" && (
              <div className="flex flex-col gap-2 rounded-xl bg-amber-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-amber-900">
                  Lunasi sekarang: {rupiah(a.totalDue)} + biaya admin.{" "}
                  {myTurnPassed
                    ? "Giliran Anda sudah dicairkan, jadi bila tidak dilunasi, tunggakan ini ditutup dari dana jaminan Anda. Selama belum lunas, Anda tidak bisa membuat atau bergabung ke kelompok baru."
                    : "Bila tidak, jumlah ini dipotong dari jatah giliran Anda. Selama belum lunas, Anda tidak bisa membuat atau bergabung ke kelompok baru."}
                </p>
                <PayButton
                  startCheckout={() => api.arrearsCheckout(a.id)}
                  label="Bayar tunggakan"
                  paidMessage="Tunggakan lunas dan diteruskan ke penerima periode itu."
                  onPaid={onChanged}
                />
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
