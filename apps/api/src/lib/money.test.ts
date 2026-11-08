import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRupiah } from "./money.js";

describe("parseRupiah", () => {
  it("membaca format Midtrans dengan atau tanpa desimal nol", () => {
    assert.equal(parseRupiah("10000.00"), 10000);
    assert.equal(parseRupiah("10000"), 10000);
    assert.equal(parseRupiah(" 5000.00 "), 5000);
    assert.equal(parseRupiah(11000), 11000);
  });

  it("menolak pecahan, negatif, dan bukan angka", () => {
    assert.equal(parseRupiah("10000.50"), null);
    assert.equal(parseRupiah("-5"), null);
    assert.equal(parseRupiah("abc"), null);
    assert.equal(parseRupiah(""), null);
    assert.equal(parseRupiah(undefined), null);
    assert.equal(parseRupiah(null), null);
  });

  it("menolak angka yang melebihi batas bilangan bulat aman", () => {
    assert.equal(parseRupiah("99999999999999999999"), null);
  });
});
