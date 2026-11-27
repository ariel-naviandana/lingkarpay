import { api } from "../api";
import type { CircleDetail } from "../types";
import { accountLabel, dateTime, rupiah } from "../lib/format";
import PayButton from "./PayButton";
import { Badge, Card, Mono } from "./ui";

/**
 * Dana jaminan anggota yang login: setor saat kelompok masih draft, terpakai bila menunggak setelah
 * gilirannya lewat, dan sisanya dikembalikan ke rekening pencairan saat kelompok selesai atau dibatalkan.
 */
export function DepositCard({ detail, onChanged }: { detail: CircleDetail; onChanged: () => void }) {
  const { circle, myMemberId } = detail;
  const amount = circle.depositAmount ?? 0;
  if (amount <= 0) return null;
  const mine = (detail.deposits ?? []).find((d) => d.memberId === myMemberId);
  const paidCount = (detail.deposits ?? []).length;
  const activeCount = detail.members.filter((m) => (m.status ?? "active") === "active").length;

  return (
    <Card className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg sm:text-xl font-extrabold">Dana jaminan</h2>
        {!mine ? (
          <Badge tone="amber">Belum disetor</Badge>
        ) : mine.status === "refunded" ? (
          <Badge tone="purple">Dikembalikan</Badge>
        ) : (
          <Badge tone="green">Ditahan</Badge>
        )}
      </div>
      <p className="text-xs text-stone-500">
        Jaminan {rupiah(amount)} per anggota (satu iuran + penalti), tanpa biaya admin. Dipakai hanya bila anggota
        menunggak setelah gilirannya lewat atau saat kelompok selesai; sisanya dikembalikan ke rekening pencairan.
      </p>

      {!mine && circle.status === "draft" && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-soft p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-900">
            Setor {rupiah(amount)} agar kelompok bisa dikunci. Kelompok dikunci setelah semua anggota menyetor.
          </p>
          <PayButton
            startCheckout={() => api.depositCheckout(circle.id)}
            label="Setor jaminan"
            paidMessage="Jaminan diterima dan ditahan sampai kelompok selesai."
            onPaid={onChanged}
          />
        </div>
      )}
      {!mine && circle.status === "cancelled" && (
        <p className="text-xs text-stone-500">Kelompok dibatalkan sebelum Anda menyetor jaminan.</p>
      )}

      {mine && (
        <div className="space-y-1 rounded-xl border border-sand p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-stone-500">Disetor</span>
            <b>
              {rupiah(mine.amount)} · {dateTime(mine.paidAt)}
            </b>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Terpakai menutup tunggakan</span>
            <b className={mine.usedAmount > 0 ? "text-red-800" : ""}>{rupiah(mine.usedAmount)}</b>
          </div>
          {mine.refund ? (
            <div className="mt-2 rounded-lg bg-mint p-2 text-brand">
              Dikembalikan {rupiah(mine.refund.amount)}
              {mine.refund.destination && (
                <>
                  {" "}
                  ke <b>{accountLabel(mine.refund.destination)}</b>
                </>
              )}
              {mine.refund.transferRef && (
                <>
                  , ref <Mono>{mine.refund.transferRef}</Mono>
                </>
              )}{" "}
              (transfer simulasi).
            </div>
          ) : (
            <div className="flex justify-between">
              <span className="text-stone-500">Sisa (dikembalikan saat kelompok selesai)</span>
              <b>{rupiah(mine.amount - mine.usedAmount)}</b>
            </div>
          )}
        </div>
      )}

      {circle.status === "draft" && (
        <p className="text-xs text-stone-500">
          {paidCount} dari {activeCount} anggota sudah menyetor jaminan.
        </p>
      )}
    </Card>
  );
}
