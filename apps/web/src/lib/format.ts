export const rupiah = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

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

export function shortenHash(hash?: string | null, len = 6): string {
  if (!hash) return "–";
  if (hash.length <= len * 2 + 2) return hash;
  return `${hash.slice(0, len + 2)}…${hash.slice(-len)}`;
}
