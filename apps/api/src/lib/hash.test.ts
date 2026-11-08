import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccakHex, randomHex, sha256Hex } from "./hash.js";

describe("hash", () => {
  it("keccak-256 sesuai vektor uji Ethereum (string kosong)", () => {
    assert.equal(
      keccakHex(""),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("keccak-256 berformat 0x + 64 heksadesimal dan deterministik", () => {
    const h = keccakHex("lingkarpay:v1:LP-1:trx-1:11000");
    assert.match(h, /^0x[0-9a-f]{64}$/);
    assert.equal(h, keccakHex("lingkarpay:v1:LP-1:trx-1:11000"));
    assert.notEqual(h, keccakHex("lingkarpay:v1:LP-1:trx-1:11001"));
  });

  it("sha256 sesuai vektor uji ('abc')", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("randomHex menghasilkan panjang yang benar dan tidak berulang", () => {
    assert.equal(randomHex(4).length, 8);
    assert.notEqual(randomHex(16), randomHex(16));
  });
});
