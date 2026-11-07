/**
 * Mengubah gross_amount Midtrans (string, mis. "10000.00") menjadi rupiah bulat.
 * Mengembalikan null bila bukan bilangan bulat rupiah yang valid.
 * Hanya untuk perbandingan jumlah. Signature tetap memakai string aslinya.
 */
export function parseRupiah(value: unknown): number | null {
  const s = String(value ?? "").trim();
  const m = /^(\d+)(?:\.0+)?$/.exec(s);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}
