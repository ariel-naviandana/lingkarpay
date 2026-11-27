/**
 * Gerbang pencairan dari contract: sebelum uang dicairkan, backend membaca status periode
 * langsung dari smart contract. Pencairan hanya berjalan bila contract juga menyatakan periode
 * siap cair dan penerimanya sama. Dengan begitu contract menjadi penentu sebelum dana bergerak,
 * bukan hanya pencatat sesudahnya.
 *
 * Mode (PAYOUT_CHAIN_CHECK):
 *   auto (bawaan) : aktif bila CHAIN_RPC_URL dan LINGKARPAY_ADDRESS diisi, dilewati bila tidak
 *   on            : wajib; pencairan ditolak bila contract tidak dapat dibaca
 *   off           : dimatikan (mis. demo tanpa worker chain)
 */
import { config } from "../config.js";
import { AppError, conflict } from "../lib/errors.js";
import { toMemberId } from "../chain/ids.js";
import { CHAIN_CIRCLE_ACTIVE, CHAIN_PERIOD, createChainReader, type ChainReader } from "../chain/reader.js";

export type PayoutChainCheckMode = "auto" | "on" | "off";

let modeOverride: PayoutChainCheckMode | undefined;
let readerOverride: ChainReader | null | undefined;
let cachedReader: ChainReader | null | undefined;

/** Khusus tes: mengganti mode dan pembaca contract. Panggil tanpa argumen untuk kembali ke konfigurasi. */
export function configurePayoutChainCheck(opts: { mode?: PayoutChainCheckMode; reader?: ChainReader | null } = {}) {
  modeOverride = opts.mode;
  readerOverride = opts.reader;
}

function currentReader(): ChainReader | null {
  if (readerOverride !== undefined) return readerOverride;
  if (cachedReader === undefined) cachedReader = createChainReader();
  return cachedReader;
}

const PERIOD_NAMES = ["Scheduled", "Running", "ReadyPayout", "Done"];

const chainUnavailable = () =>
  new AppError(
    "CHAIN_UNAVAILABLE",
    "Contract tidak dapat dibaca saat ini; pencairan ditunda. Coba lagi beberapa saat lagi.",
    503,
  );

export interface PayoutChainContext {
  chain_circle_id: string | null;
  period_no: number;
  recipient_ref: string;
}

/** Melempar error bila contract belum mengizinkan pencairan periode ini. */
export async function assertChainAllowsPayout(ctx: PayoutChainContext): Promise<void> {
  const mode = modeOverride ?? config.PAYOUT_CHAIN_CHECK;
  if (mode === "off") return;

  const reader = currentReader();
  if (!reader) {
    if (mode === "on") throw chainUnavailable();
    return; // auto tanpa konfigurasi chain: dilewati
  }

  if (!ctx.chain_circle_id) {
    throw conflict(
      "CHAIN_NOT_READY",
      "Kelompok belum tercatat di contract. Tunggu worker chain mencatatnya, lalu coba lagi.",
    );
  }

  let view;
  try {
    view = await reader.readPeriod(BigInt(ctx.chain_circle_id), ctx.period_no);
  } catch {
    throw chainUnavailable();
  }

  if (view.circleStatus !== CHAIN_CIRCLE_ACTIVE) {
    throw conflict("CHAIN_NOT_READY", "Kelompok di contract tidak berstatus aktif.");
  }
  if (view.periodStatus === CHAIN_PERIOD.Done) {
    throw conflict("CHAIN_ALREADY_PAID_OUT", "Contract mencatat periode ini sudah dicairkan.");
  }
  const ready =
    view.periodStatus === CHAIN_PERIOD.ReadyPayout ||
    (view.periodStatus === CHAIN_PERIOD.Running && view.paidCount === view.memberCount);
  if (!ready) {
    const name = PERIOD_NAMES[view.periodStatus] ?? String(view.periodStatus);
    throw conflict(
      "CHAIN_NOT_READY",
      `Contract belum menyatakan periode siap cair (status ${name}, lunas ${view.paidCount}/${view.memberCount}). ` +
        "Tunggu worker chain mencatat pembayaran atau usulan kuorum, lalu coba lagi.",
    );
  }
  if (view.recipient.toLowerCase() !== toMemberId(ctx.recipient_ref).toLowerCase()) {
    throw conflict("CHAIN_RECIPIENT_MISMATCH", "Penerima menurut contract berbeda dengan penerima di server.");
  }
}
