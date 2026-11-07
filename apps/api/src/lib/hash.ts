import { createHash, randomBytes } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";

export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

/**
 * Keccak-256 (fungsi hash bawaan Ethereum) untuk hash referensi on-chain.
 * SHA-512 hanya dipakai untuk signature webhook karena itu format Midtrans.
 */
export const keccakHex = (input: string): string =>
  "0x" + Buffer.from(keccak_256(new TextEncoder().encode(input))).toString("hex");

export const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex");
