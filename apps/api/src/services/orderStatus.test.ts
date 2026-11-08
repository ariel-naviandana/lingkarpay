import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  canTransition,
  isFinal,
  isPaid,
  mapGatewayStatus,
  type OrderStatus,
} from "./orderStatus.js";

describe("mesin status pesanan", () => {
  const allowed: Array<[OrderStatus, OrderStatus]> = [
    ["PENDING", "SETTLED"],
    ["PENDING", "FAILED"],
    ["PENDING", "EXPIRED"],
    ["SETTLED", "ANCHORED"],
    ["SETTLED", "SETTLED_PENDING_CHAIN"],
    ["SETTLED_PENDING_CHAIN", "ANCHORED"],
  ];

  it("hanya mengizinkan transisi yang terdaftar", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
      }
    }
  });

  it("status final tidak bisa berubah ke mana pun", () => {
    for (const s of ["FAILED", "EXPIRED", "ANCHORED"] as const) {
      assert.equal(isFinal(s), true, s);
      for (const to of ORDER_STATUSES) assert.equal(canTransition(s, to), false, `${s} -> ${to}`);
    }
    assert.equal(isFinal("PENDING"), false);
    assert.equal(isFinal("SETTLED"), false);
  });

  it("pembayaran yang sudah sah tidak bisa diturunkan ke PENDING/FAILED/EXPIRED", () => {
    for (const from of ["SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED"] as const) {
      for (const to of ["PENDING", "FAILED", "EXPIRED"] as const) {
        assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
      }
    }
  });

  it("isPaid hanya benar untuk status lunas", () => {
    assert.deepEqual(
      ORDER_STATUSES.filter(isPaid),
      ["SETTLED", "SETTLED_PENDING_CHAIN", "ANCHORED"],
    );
  });
});

describe("pemetaan status Midtrans", () => {
  it("settlement dan capture (bukan challenge) menjadi SETTLED", () => {
    assert.equal(mapGatewayStatus("settlement"), "SETTLED");
    assert.equal(mapGatewayStatus("capture", "accept"), "SETTLED");
    assert.equal(mapGatewayStatus("capture", "challenge"), null);
  });

  it("pending, deny/cancel/failure, dan expire", () => {
    assert.equal(mapGatewayStatus("pending"), "PENDING");
    assert.equal(mapGatewayStatus("deny"), "FAILED");
    assert.equal(mapGatewayStatus("cancel"), "FAILED");
    assert.equal(mapGatewayStatus("failure"), "FAILED");
    assert.equal(mapGatewayStatus("expire"), "EXPIRED");
  });

  it("status lain diabaikan (tidak mengubah order)", () => {
    for (const s of ["refund", "partial_refund", "chargeback", "authorize", "", undefined, null]) {
      assert.equal(mapGatewayStatus(s), null, String(s));
    }
  });

  it("tidak peka huruf besar/kecil", () => {
    assert.equal(mapGatewayStatus("SETTLEMENT"), "SETTLED");
  });
});
