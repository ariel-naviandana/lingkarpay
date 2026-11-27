/**
 * Pembatas laju sederhana (fixed window) di memori, tanpa dependensi.
 * Cukup untuk satu instance server (prototipe). Untuk beberapa instance di produksi,
 * hitungan perlu disimpan bersama, misalnya di Redis.
 */
export interface RateLimitRule {
  /** Jumlah percobaan yang diizinkan dalam satu jendela waktu. */
  max: number;
  /** Panjang jendela waktu dalam milidetik. */
  windowMs: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const SWEEP_THRESHOLD = 10_000;

export class FixedWindowLimiter {
  private readonly hits = new Map<string, Entry>();

  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = Date.now,
  ) {}

  /** Detik yang harus ditunggu bila kunci sudah mencapai batas, atau 0 bila masih boleh. */
  blockedFor(key: string): number {
    const entry = this.hits.get(key);
    const t = this.now();
    if (!entry || entry.resetAt <= t) return 0;
    return entry.count >= this.rule.max ? Math.ceil((entry.resetAt - t) / 1000) : 0;
  }

  /** Mencatat satu percobaan untuk kunci. */
  hit(key: string): void {
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.rule.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    if (this.hits.size > SWEEP_THRESHOLD) this.sweep(t);
  }

  /** Menghapus hitungan kunci (misalnya setelah login berhasil). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(t: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= t) this.hits.delete(key);
    }
  }
}
