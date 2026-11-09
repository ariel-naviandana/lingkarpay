// Tes dasar LingkarPay (Hardhat 3 + node:test + viem). Skenario lengkap dari proposal (Tabel 19) ada di contracts/README.md.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { stringToHex } from "viem";

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32. */
const memberId = (ref: string) => stringToHex(ref, { size: 32 });

describe("LingkarPay", async function () {
  const { viem } = await network.create();

  /** Kontrak baru dengan satu kelompok berisi `memberCount` anggota (belum dimulai). */
  async function deployCircle(memberCount = 2) {
    const c = await viem.deployContract("LingkarPay");
    await c.write.createCircle([100000n, memberCount, 7, 5]);
    for (let i = 1; i <= memberCount; i++) {
      await c.write.addMember([1n, memberId(`m_test${i}`)]);
    }
    return c;
  }

  it("membuat kelompok dan memancarkan event CircleCreated", async function () {
    const c = await viem.deployContract("LingkarPay");
    await viem.assertions.emitWithArgs(c.write.createCircle([100000n, 2, 7, 5]), c, "CircleCreated", [1n, 100000n, 2, 7, 5]);
  });

  it("menambah anggota berurutan, lalu memulai kelompok", async function () {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const circle = await c.read.getCircle([1n]);
    assert.equal(circle.status, 2); // Active
    assert.deepEqual(await c.read.getMembers([1n]), [memberId("m_test1"), memberId("m_test2")]);
    assert.equal(await c.read.recipientOf([1n, 2]), memberId("m_test2"));
  });

  it("menolak pencatatan oleh non-operator", async function () {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const [, other] = await viem.getWalletClients();
    await viem.assertions.revertWithCustomError(
      c.write.recordPayment([1n, 1, memberId("m_test1"), memberId("ref1"), 1700000000n], { account: other.account }),
      c,
      "NotOperator",
    );
  });

  it("mencatat iuran lunas dan menolak pencatatan dua kali", async function () {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const args = [1n, 1, memberId("m_test1"), memberId("ref1"), 1700000000n] as const;
    await c.write.recordPayment(args);
    const pay = await c.read.getPayment([1n, 1, memberId("m_test1")]);
    assert.equal(pay.paid, true);
    await viem.assertions.revertWithCustomError(c.write.recordPayment(args), c, "AlreadyRecorded");
  });

  it("parameter terkunci setelah kelompok dimulai (tidak bisa menambah anggota)", async function () {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    await viem.assertions.revertWithCustomError(c.write.addMember([1n, memberId("m_test3")]), c, "WrongStatus");
  });

  // TODO(smart-contract): tes untuk fungsi yang belum dikerjakan (T1 sampai T3)
  it.todo("markPayout menutup periode, membuka periode berikutnya, dan menutup kelompok di periode terakhir");
  it.todo("closePeriod ditolak bila iuran belum lengkap");
  it.todo("applyPenalty: sekali per anggota per periode, ditolak sebelum tenggat, nilai sama dengan penaltyDue");
  it.todo("penerima periode sesuai urutan terkunci, bukan pilihan operator");
  it.todo("kuorum tidak tercapai: keputusan tidak berlaku");
});
