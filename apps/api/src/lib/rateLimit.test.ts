import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowLimiter } from "./rateLimit.js";

describe("FixedWindowLimiter", () => {
  it("mengizinkan sampai batas, lalu memblokir dengan sisa waktu", () => {
    let t = 0;
    const limiter = new FixedWindowLimiter({ max: 3, windowMs: 60_000 }, () => t);
    for (let i = 0; i < 3; i += 1) {
      assert.equal(limiter.blockedFor("a"), 0);
      limiter.hit("a");
    }
    assert.equal(limiter.blockedFor("a"), 60);
    t = 30_000;
    assert.equal(limiter.blockedFor("a"), 30);
  });

  it("membuka lagi setelah jendela waktu habis", () => {
    let t = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1_000 }, () => t);
    limiter.hit("a");
    assert.ok(limiter.blockedFor("a") > 0);
    t = 1_000;
    assert.equal(limiter.blockedFor("a"), 0);
    limiter.hit("a");
    assert.ok(limiter.blockedFor("a") > 0);
  });

  it("kunci saling terpisah dan reset menghapus hitungan", () => {
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 60_000 }, () => 0);
    limiter.hit("a");
    assert.ok(limiter.blockedFor("a") > 0);
    assert.equal(limiter.blockedFor("b"), 0);
    limiter.reset("a");
    assert.equal(limiter.blockedFor("a"), 0);
  });
});
