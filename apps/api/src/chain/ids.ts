import { keccak256, stringToHex, type Hex } from "viem";

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32 untuk contract. */
export const toMemberId = (ref: string): Hex => stringToHex(ref, { size: 32 });

/** Referensi eksternal kelompok: hash tetap dari id kelompok di database. Dipakai contract untuk mencegah kelompok ganda. */
export const circleRef = (circleDbId: number): Hex =>
  keccak256(stringToHex(`lingkarpay:circle:${circleDbId}`));
