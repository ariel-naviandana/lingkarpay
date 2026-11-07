import type { SnapItem } from "./midtrans.js";

export interface BillInput {
  /** Iuran per periode (rupiah bulat). */
  contributionAmount: number;
  /** Persentase penalti keterlambatan (0-100). */
  penaltyPct: number;
  /** Biaya admin LingkarPay per iuran (rupiah bulat). */
  adminFee: number;
  /** Tenggat periode. */
  dueDate: Date;
  now?: Date;
}

export interface Bill {
  amount: number;
  penaltyAmount: number;
  adminFee: number;
  /** iuran + penalti + biaya admin. Ini yang dikirim sebagai gross_amount. */
  grossAmount: number;
  overdue: boolean;
}

/**
 * Penalti keterlambatan: persentase tetap dari iuran bila lewat tenggat, dibulatkan ke atas.
 * Aturan yang sama berlaku untuk semua anggota. Nanti dapat diganti pembacaan dari contract
 * tanpa mengubah pemanggil.
 */
export function computePenalty(
  contributionAmount: number,
  penaltyPct: number,
  dueDate: Date,
  now: Date = new Date(),
): number {
  if (penaltyPct <= 0 || now.getTime() <= dueDate.getTime()) return 0;
  // Aritmetika bilangan bulat: ceil(iuran * pct / 100) tanpa float.
  return Math.floor((contributionAmount * penaltyPct + 99) / 100);
}

export function computeBill(input: BillInput): Bill {
  const now = input.now ?? new Date();
  const penaltyAmount = computePenalty(
    input.contributionAmount,
    input.penaltyPct,
    input.dueDate,
    now,
  );
  return {
    amount: input.contributionAmount,
    penaltyAmount,
    adminFee: input.adminFee,
    grossAmount: input.contributionAmount + penaltyAmount + input.adminFee,
    overdue: penaltyAmount > 0,
  };
}

/** Rincian untuk item_details Snap. Jumlahnya selalu sama dengan grossAmount. */
export function billItems(bill: Bill): SnapItem[] {
  const items: SnapItem[] = [
    { id: "iuran", name: "Iuran arisan", price: bill.amount, quantity: 1 },
  ];
  if (bill.penaltyAmount > 0) {
    items.push({ id: "penalti", name: "Penalti keterlambatan", price: bill.penaltyAmount, quantity: 1 });
  }
  if (bill.adminFee > 0) {
    items.push({ id: "admin", name: "Biaya layanan", price: bill.adminFee, quantity: 1 });
  }
  return items;
}
