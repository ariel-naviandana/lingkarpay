import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSignature, verifySignature } from "./signature.js";

const KEY = "kunci-rahasia-uji";
const base = { order_id: "LP-1-1-1-abc", status_code: "200", gross_amount: "11000.00" };
const signed = (o = base, key = KEY) => ({
  ...o,
  signature_key: computeSignature(o.order_id, o.status_code, o.gross_amount, key),
});

describe("signature Midtrans", () => {
  it("memakai rumus SHA512(order_id + status_code + gross_amount + key)", () => {
    const expected = createHash("sha512")
      .update("LP-1-1-1-abc" + "200" + "11000.00" + KEY)
      .digest("hex");
    assert.equal(computeSignature("LP-1-1-1-abc", "200", "11000.00", KEY), expected);
    assert.equal(expected.length, 128);
  });

  it("menerima payload dengan signature yang benar", () => {
    assert.equal(verifySignature(signed(), KEY), true);
  });

  it("menolak bila kunci berbeda", () => {
    assert.equal(verifySignature(signed(), "kunci-lain"), false);
  });

  it("menolak bila field berubah (mis. gross_amount dimanipulasi)", () => {
    const p = signed();
    assert.equal(verifySignature({ ...p, gross_amount: "1000.00" }, KEY), false);
    assert.equal(verifySignature({ ...p, order_id: "LP-2" }, KEY), false);
    assert.equal(verifySignature({ ...p, status_code: "201" }, KEY), false);
  });

  it("peka terhadap format gross_amount: '11000.00' tidak sama dengan '11000'", () => {
    const p = signed();
    assert.equal(verifySignature({ ...p, gross_amount: "11000" }, KEY), false);
  });

  it("menolak signature kosong, bukan string, atau panjangnya salah", () => {
    assert.equal(verifySignature({ ...base }, KEY), false);
    assert.equal(verifySignature({ ...base, signature_key: 123 }, KEY), false);
    assert.equal(verifySignature({ ...base, signature_key: "abc" }, KEY), false);
    assert.equal(verifySignature({ ...base, signature_key: "" }, KEY), false);
  });
});
