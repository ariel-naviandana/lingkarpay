// KERANGKA tes (Hardhat 3 + viem + node:test). Sesuaikan dengan hasil `npx hardhat --init`.
// Skenario lengkap yang diminta proposal (Tabel 19) ada di contracts/README.md.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { stringToHex } from "viem";

const { viem } = await network.connect();

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32. */
const memberId = (ref: string) => stringToHex(ref, { size: 32 });

async function deployCircle(memberCount = 2) {
  const contract = await viem.deployContract("LingkarPay");
  await contract.write.createCircle([100000n, memberCount, 7, 5]);
  for (let i = 1; i <= memberCount; i++) {
    await contract.write.addMember([1n, memberId(`m_test${i}`)]);
  }
  return contract;
}

describe("LingkarPay", () => {
  it("membuat kelompok, menambah anggota berurutan, lalu memulai", async () => {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const circle = await c.read.getCircle([1n]);
    assert.equal(circle.status, 2); // Active
    assert.deepEqual(await c.read.getMembers([1n]), [memberId("m_test1"), memberId("m_test2")]);
    assert.equal(await c.read.recipientOf([1n, 2]), memberId("m_test2"));
  });

  it("menolak pencatatan oleh non-operator", async () => {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const [, other] = await viem.getWalletClients();
    await assert.rejects(
      c.write.recordPayment([1n, 1, memberId("m_test1"), memberId("ref1"), 1700000000n], {
        account: other.account,
      }),
    );
  });

  it("mencatat iuran lunas dan menolak pencatatan dua kali", async () => {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    const args = [1n, 1, memberId("m_test1"), memberId("ref1"), 1700000000n] as const;
    await c.write.recordPayment(args);
    const pay = await c.read.getPayment([1n, 1, memberId("m_test1")]);
    assert.equal(pay.paid, true);
    await assert.rejects(c.write.recordPayment(args));
  });

  it("parameter tidak bisa diubah setelah kelompok dimulai (tidak bisa menambah anggota)", async () => {
    const c = await deployCircle(2);
    await c.write.startCircle([1n]);
    await assert.rejects(c.write.addMember([1n, memberId("m_test3")]));
  });

  // TODO(smart-contract): tes untuk fungsi yang belum dikerjakan
  it.todo("pembayaran lewat tenggat memicu penalti sesuai aturan (applyPenalty)");
  it.todo("penutupan periode saat iuran belum lengkap tanpa kuorum ditolak (closePeriod)");
  it.todo("penerima periode sesuai urutan terkunci, bukan pilihan operator");
  it.todo("markPayout membuka periode berikutnya dan menutup kelompok di periode terakhir");
  it.todo("kuorum tidak tercapai: keputusan tidak berlaku");
});
