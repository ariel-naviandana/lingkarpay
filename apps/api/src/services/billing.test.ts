import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { billItems, computeBill, computePenalty } from "./billing.js";

const due = new Date("2026-11-10T00:00:00.000Z");
const before = new Date("2026-11-09T23:59:59.000Z");
const after = new Date("2026-11-10T00:00:01.000Z");

describe("penalti keterlambatan", () => {
  it("nol bila belum atau tepat pada tenggat", () => {
    assert.equal(computePenalty(10000, 5, due, before), 0);
    assert.equal(computePenalty(10000, 5, due, due), 0);
  });

  it("persentase dari iuran bila lewat tenggat", () => {
    assert.equal(computePenalty(10000, 5, due, after), 500);
    assert.equal(computePenalty(100000, 10, due, after), 10000);
  });

  it("dibulatkan ke atas tanpa float", () => {
    assert.equal(computePenalty(10001, 5, due, after), 501); // 500,05 -> 501
    assert.equal(computePenalty(1, 1, due, after), 1);
    assert.equal(computePenalty(333, 7, due, after), 24); // 23,31 -> 24
  });

  it("nol bila persentase 0", () => {
    assert.equal(computePenalty(10000, 0, due, after), 0);
  });
});

describe("tagihan", () => {
  it("tepat waktu: iuran + biaya admin", () => {
    const b = computeBill({ contributionAmount: 10000, penaltyPct: 5, adminFee: 1000, dueDate: due, now: before });
    assert.deepEqual(b, { amount: 10000, penaltyAmount: 0, adminFee: 1000, grossAmount: 11000, overdue: false });
  });

  it("terlambat: iuran + penalti + biaya admin", () => {
    const b = computeBill({ contributionAmount: 10000, penaltyPct: 5, adminFee: 1000, dueDate: due, now: after });
    assert.deepEqual(b, { amount: 10000, penaltyAmount: 500, adminFee: 1000, grossAmount: 11500, overdue: true });
  });

  it("tanpa biaya admin", () => {
    const b = computeBill({ contributionAmount: 10000, penaltyPct: 0, adminFee: 0, dueDate: due, now: after });
    assert.equal(b.grossAmount, 10000);
  });

  it("rincian item Snap selalu berjumlah sama dengan gross_amount", () => {
    for (const now of [before, after]) {
      for (const adminFee of [0, 1000]) {
        const b = computeBill({ contributionAmount: 10001, penaltyPct: 5, adminFee, dueDate: due, now });
        const sum = billItems(b).reduce((s, i) => s + i.price * i.quantity, 0);
        assert.equal(sum, b.grossAmount);
      }
    }
  });

  it("item penalti dan biaya admin hanya muncul bila ada", () => {
    const onTime = computeBill({ contributionAmount: 10000, penaltyPct: 5, adminFee: 0, dueDate: due, now: before });
    assert.deepEqual(billItems(onTime).map((i) => i.id), ["iuran"]);
    const late = computeBill({ contributionAmount: 10000, penaltyPct: 5, adminFee: 1000, dueDate: due, now: after });
    assert.deepEqual(billItems(late).map((i) => i.id), ["iuran", "penalti", "admin"]);
  });
});
