import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRejected, quorumOf } from "./quorum.js";

describe("kuorum", () => {
  it("mayoritas mutlak anggota", () => {
    assert.equal(quorumOf(2), 2);
    assert.equal(quorumOf(3), 2);
    assert.equal(quorumOf(4), 3);
    assert.equal(quorumOf(5), 3);
    assert.equal(quorumOf(50), 26);
  });

  it("ditolak hanya bila kuorum mustahil tercapai", () => {
    // 4 anggota, kuorum 3: satu penolak masih bisa disusul tiga setuju; dua penolak mustahil
    assert.equal(isRejected(1, 4), false);
    assert.equal(isRejected(2, 4), true);
    // 3 anggota, kuorum 2
    assert.equal(isRejected(1, 3), false);
    assert.equal(isRejected(2, 3), true);
    // 2 anggota, kuorum 2: satu penolak sudah cukup
    assert.equal(isRejected(1, 2), true);
  });
});
