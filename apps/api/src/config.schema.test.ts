import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "./config.schema.js";

const minimal = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  MIDTRANS_SERVER_KEY: "rahasia-server-key",
  MIDTRANS_CLIENT_KEY: "client-key",
};

describe("konfigurasi (.env)", () => {
  it("nilai bawaan: boolean sungguhan, bukan string", () => {
    const c = parseConfig(minimal);
    assert.strictEqual(c.DEV_TOOLS, true);
    assert.strictEqual(c.IRIS_ENABLED, false); // bukan string "false" yang bernilai benar
    assert.equal(c.PORT, 3001);
    assert.equal(c.ORDER_EXPIRY_MINUTES, 60);
    assert.equal(c.DEFAULT_ADMIN_FEE, 1000);
    assert.equal(c.IRIS_OTP, "335163");
    assert.equal(c.NODE_ENV, "development");
    assert.equal(c.MIDTRANS_SIGNATURE_KEY, undefined);
  });

  it("membaca boolean dari string", () => {
    const c = parseConfig({ ...minimal, DEV_TOOLS: "false", IRIS_ENABLED: "true" });
    assert.strictEqual(c.DEV_TOOLS, false);
    assert.strictEqual(c.IRIS_ENABLED, true);
  });

  it("menolak boolean yang bukan true/false", () => {
    assert.throws(() => parseConfig({ ...minimal, DEV_TOOLS: "yes" }), /DEV_TOOLS/);
  });

  it("Signature Secret Key: kosong dianggap tidak ada, spasi dipangkas", () => {
    assert.equal(parseConfig({ ...minimal, MIDTRANS_SIGNATURE_KEY: "" }).MIDTRANS_SIGNATURE_KEY, undefined);
    assert.equal(parseConfig({ ...minimal, MIDTRANS_SIGNATURE_KEY: "  abc  " }).MIDTRANS_SIGNATURE_KEY, "abc");
  });

  it("variabel wajib yang kurang ditolak; pesan tidak memuat nilai rahasia", () => {
    const { DATABASE_URL: _drop, ...tanpaDb } = minimal;
    assert.throws(
      () => parseConfig(tanpaDb),
      (e: unknown) => {
        const m = (e as Error).message;
        return m.includes("DATABASE_URL") && !m.includes("rahasia-server-key");
      },
    );
  });

  it("konfigurasi chain: bawaan Sepolia dan semua nilai opsional", () => {
    const c = parseConfig(minimal);
    assert.equal(c.CHAIN_NAME, "sepolia");
    assert.equal(c.CHAIN_RPC_URL, undefined);
    assert.equal(c.OPERATOR_PRIVATE_KEY, undefined);
    assert.equal(c.LINGKARPAY_ADDRESS, undefined);
    assert.equal(parseConfig({ ...minimal, OPERATOR_PRIVATE_KEY: "", LINGKARPAY_ADDRESS: "  " }).OPERATOR_PRIVATE_KEY, undefined);
  });

  it("konfigurasi chain: nilai valid diterima", () => {
    const c = parseConfig({
      ...minimal,
      CHAIN_NAME: "hardhat",
      CHAIN_RPC_URL: "http://127.0.0.1:8545",
      OPERATOR_PRIVATE_KEY: "0x" + "ab".repeat(32),
      LINGKARPAY_ADDRESS: "0x" + "cd".repeat(20),
    });
    assert.equal(c.CHAIN_NAME, "hardhat");
    assert.equal(c.LINGKARPAY_ADDRESS, "0x" + "cd".repeat(20));
  });

  it("konfigurasi chain: format salah ditolak tanpa membocorkan nilainya", () => {
    const rahasia = "0xrahasia-bukan-heks";
    assert.throws(
      () => parseConfig({ ...minimal, OPERATOR_PRIVATE_KEY: rahasia }),
      (e: unknown) => {
        const m = (e as Error).message;
        return m.includes("OPERATOR_PRIVATE_KEY") && !m.includes(rahasia);
      },
    );
    assert.throws(() => parseConfig({ ...minimal, LINGKARPAY_ADDRESS: "0x123" }), /LINGKARPAY_ADDRESS/);
    assert.throws(() => parseConfig({ ...minimal, CHAIN_NAME: "mainnet" }), /CHAIN_NAME/);
  });

  it("batas nilai: ORDER_EXPIRY_MINUTES minimal 5", () => {
    assert.throws(() => parseConfig({ ...minimal, ORDER_EXPIRY_MINUTES: "2" }), /ORDER_EXPIRY_MINUTES/);
    assert.equal(parseConfig({ ...minimal, ORDER_EXPIRY_MINUTES: "5" }).ORDER_EXPIRY_MINUTES, 5);
  });
});
