/** Kuorum = mayoritas mutlak anggota (sama dengan contract: anggota / 2 + 1). */
export function quorumOf(memberCount: number): number {
  return Math.floor(memberCount / 2) + 1;
}

/** Usulan ditolak bila kuorum sudah mustahil tercapai (sama dengan aturan di contract). */
export function isRejected(rejections: number, memberCount: number): boolean {
  return rejections > memberCount - quorumOf(memberCount);
}
