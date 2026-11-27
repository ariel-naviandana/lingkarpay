export const rupiah = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

/** "BCA ••••7890 a.n. Budi" dari rekening tersamar. */
export const accountLabel = (a: { channelLabel: string; last4: string; accountName: string }) =>
  `${a.channelLabel} ••••${a.last4} a.n. ${a.accountName}`;

export function formatDate(dateString?: string | Date | null): string {
  if (!dateString) return "–";
  const d = typeof dateString === "string" ? new Date(dateString) : dateString;
  if (isNaN(d.getTime())) return String(dateString);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Tanggal hari ini di WIB (YYYY-MM-DD), sama dengan acuan server untuk tanggal mulai. */
export const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Format tanggal kalender YYYY-MM-DD tanpa geser zona waktu, mis. "27 Nov 2026". */
export function formatYmd(ymd?: string | null): string {
  if (!ymd) return "–";
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : formatDate(d);
}

export function formatDateTime(dateString?: string | Date | null): string {
  if (!dateString) return "–";
  const d = typeof dateString === "string" ? new Date(dateString) : dateString;
  if (isNaN(d.getTime())) return String(dateString);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateTime(dateString?: string | Date | number | null): string {
  if (!dateString) return "–";
  const d = typeof dateString === "string" || typeof dateString === "number" ? new Date(dateString) : dateString;
  if (isNaN(d.getTime())) return String(dateString);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDate(dateString?: string | Date | number | null): string {
  if (!dateString) return "–";
  const d = typeof dateString === "string" || typeof dateString === "number" ? new Date(dateString) : dateString;
  if (isNaN(d.getTime())) return String(dateString);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}

export function daysLate(dueDate: string | Date | number): number {
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return 0;
  const diff = Date.now() - d.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export const circleStatus: Record<string, readonly [string, "green" | "amber" | "gray" | "purple" | "red"]> = {
  draft: ["Belum dimulai", "gray"],
  active: ["Berjalan", "green"],
  completed: ["Selesai", "purple"],
  cancelled: ["Dibatalkan", "red"],
};

export const periodStatus: Record<string, string> = {
  scheduled: "Mendatang",
  running: "Berjalan",
  ready_payout: "Siap cair",
  done: "Selesai",
};

export function orderLabel(status: string): readonly [string, "green" | "amber" | "red" | "purple" | "gray"] {
  switch (status) {
    case "ANCHORED":
      return ["Lunas · on-chain", "green"];
    case "SETTLED":
    case "SETTLED_PENDING_CHAIN":
      return ["Lunas · menunggu rantai", "purple"];
    case "PENDING":
      return ["Menunggu pembayaran", "amber"];
    case "FAILED":
      return ["Gagal", "red"];
    case "EXPIRED":
      return ["Kedaluwarsa", "red"];
    default:
      return [status, "gray"];
  }
}

export function paymentMethod(paymentType?: string | null): string {
  if (!paymentType) return "–";
  const map: Record<string, string> = {
    bank_transfer: "Virtual Account",
    echannel: "Mandiri Bill",
    gopay: "GoPay",
    shopeepay: "ShopeePay",
    qris: "QRIS",
    credit_card: "Kartu Kredit",
  };
  return map[paymentType] || paymentType;
}

export function etherscanTx(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

export function shortHash(hash?: string | null, len = 4): string {
  if (!hash) return "–";
  if (hash.length <= len * 2 + 2) return hash;
  return `${hash.slice(0, len + 2)}…${hash.slice(-len)}`;
}

export function shortenHash(hash?: string | null, len = 6): string {
  if (!hash) return "–";
  if (hash.length <= len * 2 + 2) return hash;
  return `${hash.slice(0, len + 2)}…${hash.slice(-len)}`;
}
