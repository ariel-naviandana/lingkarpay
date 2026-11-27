/**
 * Rekening pencairan anggota (data dummy di sandbox). Diisi oleh anggota sendiri, karena dalam
 * proses bisnis penerima giliran yang menentukan ke mana dananya ditransfer.
 * Nomor lengkap tidak disimpan: hanya 4 digit terakhir dan hash Keccak-256 "kanal:nomor".
 */
import { pool } from "../db/pool.js";
import { AppError, forbidden } from "../lib/errors.js";
import { keccakHex } from "../lib/hash.js";

export const PAYOUT_CHANNELS = {
  BCA: { label: "BCA", kind: "bank" },
  BNI: { label: "BNI", kind: "bank" },
  BRI: { label: "BRI", kind: "bank" },
  MANDIRI: { label: "Mandiri", kind: "bank" },
  BSI: { label: "BSI", kind: "bank" },
  CIMB: { label: "CIMB Niaga", kind: "bank" },
  PERMATA: { label: "Permata", kind: "bank" },
  GOPAY: { label: "GoPay", kind: "ewallet" },
  OVO: { label: "OVO", kind: "ewallet" },
  DANA: { label: "DANA", kind: "ewallet" },
  SHOPEEPAY: { label: "ShopeePay", kind: "ewallet" },
} as const;

export type PayoutChannel = keyof typeof PAYOUT_CHANNELS;
export const PAYOUT_CHANNEL_CODES = Object.keys(PAYOUT_CHANNELS) as [PayoutChannel, ...PayoutChannel[]];

export interface PayoutAccountView {
  channel: string;
  channelLabel: string;
  kind: "bank" | "ewallet";
  last4: string;
  accountName: string;
  updatedAt: Date | null;
}

/** Tampilan rekening tersamar, atau null bila belum diisi. */
export function toPayoutAccount(row: {
  payout_channel: string | null;
  payout_account_last4: string | null;
  payout_account_name: string | null;
  payout_account_updated_at?: Date | null;
}): PayoutAccountView | null {
  if (!row.payout_channel || !row.payout_account_last4 || !row.payout_account_name) return null;
  return destinationView(row.payout_channel, row.payout_account_last4, row.payout_account_name, row.payout_account_updated_at ?? null);
}

export function destinationView(
  channel: string,
  last4: string,
  accountName: string,
  updatedAt: Date | null = null,
): PayoutAccountView {
  const info = PAYOUT_CHANNELS[channel as PayoutChannel];
  return {
    channel,
    channelLabel: info?.label ?? channel,
    kind: info?.kind ?? "bank",
    last4,
    accountName,
    updatedAt,
  };
}

/** Validasi nomor: bank 6-20 digit; e-wallet nomor ponsel 08xxxxxxxx (10-14 digit). */
export function validateAccountNumber(channel: PayoutChannel, accountNumber: string): string {
  const digits = accountNumber.replace(/[\s-]/g, "");
  const ok =
    PAYOUT_CHANNELS[channel].kind === "bank" ? /^\d{6,20}$/.test(digits) : /^08\d{8,12}$/.test(digits);
  if (!ok) {
    throw new AppError(
      "INVALID_ACCOUNT_NUMBER",
      PAYOUT_CHANNELS[channel].kind === "bank"
        ? "Nomor rekening harus 6 sampai 20 digit angka"
        : "Nomor e-wallet harus nomor ponsel yang diawali 08 (10 sampai 14 digit)",
      400,
    );
  }
  return digits;
}

export interface PayoutAccountInput {
  channel: PayoutChannel;
  accountNumber: string;
  accountName: string;
}

/** Nilai kolom rekening yang disimpan (tervalidasi): kanal, 4 digit terakhir, nama, hash. */
export function accountColumns(input: PayoutAccountInput) {
  const digits = validateAccountNumber(input.channel, input.accountNumber);
  return {
    channel: input.channel,
    last4: digits.slice(-4),
    name: input.accountName.trim(),
    hash: keccakHex(`${input.channel}:${digits}`),
  };
}

/** Anggota mengisi atau mengganti rekening pencairannya sendiri di satu kelompok. */
export async function setPayoutAccount(
  userId: number,
  circleId: number,
  input: PayoutAccountInput,
): Promise<PayoutAccountView> {
  const acct = accountColumns(input);
  const { rows } = await pool.query<{
    payout_channel: string;
    payout_account_last4: string;
    payout_account_name: string;
    payout_account_updated_at: Date;
  }>(
    `UPDATE members
        SET payout_channel = $3, payout_account_last4 = $4, payout_account_name = $5,
            payout_account_hash = $6, payout_account_updated_at = now()
      WHERE circle_id = $1 AND user_id = $2 AND status = 'active'
      RETURNING payout_channel, payout_account_last4, payout_account_name, payout_account_updated_at`,
    [circleId, userId, acct.channel, acct.last4, acct.name, acct.hash],
  );
  if (!rows[0]) throw forbidden("Anda bukan anggota kelompok ini");
  return toPayoutAccount(rows[0])!;
}
