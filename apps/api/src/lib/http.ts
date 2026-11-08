import https from "node:https";

export interface HttpResult {
  status: number;
  ok: boolean;
  json: Record<string, any>;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Batas waktu tiap percobaan (ms). */
  timeoutMs?: number;
  /** Jumlah percobaan ulang bila gagal terhubung. */
  retries?: number;
}

const RETRYABLE = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Satu percobaan HTTPS. Koneksi dipaksa IPv4 (family: 4): di beberapa jaringan Node memilih
 * alamat yang tidak bisa dijangkau dan menunggu timeout, padahal IPv4 berfungsi normal.
 */
function attempt(
  url: string,
  opts: RequestOptions,
): Promise<{ result: HttpResult } | { error: Error & { code?: string }; connected: boolean }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    let connected = false;

    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: opts.method ?? "GET",
        family: 4,
        timeout: opts.timeoutMs ?? 20_000,
        headers: {
          ...opts.headers,
          ...(payload !== undefined ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, any> = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = {};
          }
          const status = res.statusCode ?? 0;
          resolve({ result: { status, ok: status >= 200 && status < 300, json } });
        });
        res.on("error", (e) => resolve({ error: e as Error & { code?: string }, connected }));
      },
    );
    req.on("socket", (socket) => {
      socket.on("connect", () => {
        connected = true;
      });
    });
    req.on("timeout", () => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    });
    req.on("error", (e) => resolve({ error: e as Error & { code?: string }, connected }));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/**
 * Permintaan HTTPS JSON dengan percobaan ulang. GET diulang untuk error jaringan apa pun yang
 * bisa dicoba lagi; POST hanya diulang bila koneksi belum terbentuk (permintaan belum terkirim),
 * supaya tidak membuat transaksi ganda.
 */
export async function requestJson(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
  const method = opts.method ?? "GET";
  const maxRetries = opts.retries ?? 2;
  let lastError: Error & { code?: string } = new Error("unknown");

  for (let i = 0; i <= maxRetries; i++) {
    const r = await attempt(url, opts);
    if ("result" in r) return r.result;
    lastError = r.error;
    const retryable = RETRYABLE.has(r.error.code ?? "") && (method === "GET" || !r.connected);
    if (!retryable || i === maxRetries) break;
    await sleep(500 * (i + 1));
  }
  throw lastError;
}
