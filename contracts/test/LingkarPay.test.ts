// Tes LingkarPay (Hardhat 3 + node:test + viem). Skenario mengikuti proposal Tabel 19 dan keputusan desain
// yang disepakati (contracts/README.md): markPayout menutup periode sendiri, applyPenalty mencatat denda terutang.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { stringToHex } from "viem";

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32. */
const memberId = (ref: string) => stringToHex(ref, { size: 32 });
const REF = (n: number) => stringToHex(`ref${n}`, { size: 32 });
const PAYOUT = (n: number) => stringToHex(`payout${n}`, { size: 32 });

const CONTRIBUTION = 100000n;
const PENALTY_PCT = 5;
const PENALTY_AMOUNT = 5000n; // ceil(100000 * 5 / 100)

const Status = { Draft: 1, Active: 2, Completed: 3 } as const;
const PeriodStatus = { Scheduled: 0, Running: 1, ReadyPayout: 2, Done: 3 } as const;

describe("LingkarPay", async function () {
  const { viem, networkHelpers } = await network.create();

  /** Kontrak dengan satu kelompok yang sudah berisi anggota tetapi belum dimulai. */
  async function deployDraft(memberCount = 2, penaltyPct = PENALTY_PCT) {
    const c = await viem.deployContract("LingkarPay");
    await c.write.createCircle([CONTRIBUTION, memberCount, 7, penaltyPct]);
    for (let i = 1; i <= memberCount; i++) {
      await c.write.addMember([1n, memberId(`m_test${i}`)]);
    }
    return c;
  }
  type Contract = Awaited<ReturnType<typeof deployDraft>>;

  async function deployStarted(memberCount = 2, penaltyPct = PENALTY_PCT) {
    const c = await deployDraft(memberCount, penaltyPct);
    await c.write.startCircle([1n]);
    return c;
  }

  /** Semua anggota membayar periode `periodNo`. */
  async function payPeriod(c: Contract, periodNo: number, memberCount = 2) {
    for (let i = 1; i <= memberCount; i++) {
      await c.write.recordPayment([1n, periodNo, memberId(`m_test${i}`), REF(periodNo * 100 + i), 1700000000n]);
    }
  }

  const periodStatus = async (c: Contract, periodNo: number) => (await c.read.getPeriod([1n, periodNo])).status;

  // ------------------------------------------------------------ kelompok (sudah ada)
  describe("kelompok", () => {
    it("membuat kelompok dan memancarkan event CircleCreated", async function () {
      const c = await viem.deployContract("LingkarPay");
      await viem.assertions.emitWithArgs(c.write.createCircle([CONTRIBUTION, 2, 7, 5]), c, "CircleCreated", [1n, CONTRIBUTION, 2, 7, 5]);
    });

    it("menambah anggota berurutan, lalu memulai kelompok", async function () {
      const c = await deployDraft(2);
      await c.write.startCircle([1n]);
      const circle = await c.read.getCircle([1n]);
      assert.equal(circle.status, Status.Active);
      assert.deepEqual(await c.read.getMembers([1n]), [memberId("m_test1"), memberId("m_test2")]);
      assert.equal(await periodStatus(c, 1), PeriodStatus.Running);
    });

    it("parameter createCircle tidak valid ditolak", async function () {
      const c = await viem.deployContract("LingkarPay");
      await viem.assertions.revertWithCustomError(c.write.createCircle([0n, 2, 7, 5]), c, "InvalidParams");
      await viem.assertions.revertWithCustomError(c.write.createCircle([CONTRIBUTION, 1, 7, 5]), c, "InvalidParams");
      await viem.assertions.revertWithCustomError(c.write.createCircle([CONTRIBUTION, 2, 0, 5]), c, "InvalidParams");
      await viem.assertions.revertWithCustomError(c.write.createCircle([CONTRIBUTION, 2, 7, 101]), c, "InvalidParams");
    });

    it("hanya operator yang boleh membuat kelompok", async function () {
      const c = await viem.deployContract("LingkarPay");
      const [, other] = await viem.getWalletClients();
      await viem.assertions.revertWithCustomError(
        c.write.createCircle([CONTRIBUTION, 2, 7, 5], { account: other.account }),
        c,
        "NotOperator",
      );
    });

    it("anggota melebihi jumlah atau ganda ditolak", async function () {
      const c = await deployDraft(2);
      await viem.assertions.revertWithCustomError(c.write.addMember([1n, memberId("m_test3")]), c, "CircleFull");
      const d = await viem.deployContract("LingkarPay");
      await d.write.createCircle([CONTRIBUTION, 3, 7, 5]);
      await d.write.addMember([1n, memberId("m_test1")]);
      await viem.assertions.revertWithCustomError(d.write.addMember([1n, memberId("m_test1")]), d, "AlreadyMember");
    });

    it("kelompok tidak bisa dimulai sebelum anggota lengkap, dan tidak bisa dimulai dua kali", async function () {
      const d = await viem.deployContract("LingkarPay");
      await d.write.createCircle([CONTRIBUTION, 3, 7, 5]);
      await d.write.addMember([1n, memberId("m_test1")]);
      await viem.assertions.revertWithCustomError(d.write.startCircle([1n]), d, "InvalidParams");
      const c = await deployStarted(2);
      await viem.assertions.revertWithCustomError(c.write.startCircle([1n]), c, "WrongStatus");
    });

    it("parameter terkunci setelah kelompok dimulai (tidak bisa menambah anggota)", async function () {
      const c = await deployStarted(2);
      await viem.assertions.revertWithCustomError(c.write.addMember([1n, memberId("m_test3")]), c, "WrongStatus");
    });

    it("penerima tiap periode sesuai urutan giliran yang terkunci, bukan pilihan operator", async function () {
      const c = await deployStarted(3);
      assert.equal(await c.read.recipientOf([1n, 1]), memberId("m_test1"));
      assert.equal(await c.read.recipientOf([1n, 2]), memberId("m_test2"));
      assert.equal(await c.read.recipientOf([1n, 3]), memberId("m_test3"));
      await viem.assertions.revertWithCustomError(c.read.recipientOf([1n, 4]), c, "InvalidParams");
    });
  });

  // ----------------------------------------------------------- pembayaran (sudah ada)
  describe("recordPayment", () => {
    it("menolak pencatatan oleh non-operator", async function () {
      const c = await deployStarted(2);
      const [, other] = await viem.getWalletClients();
      await viem.assertions.revertWithCustomError(
        c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), 1700000000n], { account: other.account }),
        c,
        "NotOperator",
      );
    });

    it("mencatat iuran lunas dan menolak pencatatan dua kali", async function () {
      const c = await deployStarted(2);
      const args = [1n, 1, memberId("m_test1"), REF(1), 1700000000n] as const;
      await c.write.recordPayment(args);
      const pay = await c.read.getPayment([1n, 1, memberId("m_test1")]);
      assert.equal(pay.paid, true);
      assert.equal(pay.refHash, REF(1));
      await viem.assertions.revertWithCustomError(c.write.recordPayment(args), c, "AlreadyRecorded");
    });

    it("menolak anggota tak terdaftar dan periode yang belum berjalan", async function () {
      const c = await deployStarted(2);
      await viem.assertions.revertWithCustomError(
        c.write.recordPayment([1n, 1, memberId("m_asing"), REF(1), 1700000000n]),
        c,
        "NotMember",
      );
      await viem.assertions.revertWithCustomError(
        c.write.recordPayment([1n, 2, memberId("m_test1"), REF(1), 1700000000n]),
        c,
        "PeriodNotRunning",
      );
    });

    it("event menandai pembayaran terlambat (late) berdasarkan tenggat", async function () {
      const c = await deployStarted(2);
      const due = await c.read.dueDate([1n, 1]);
      await viem.assertions.emitWithArgs(
        c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), due - 10n]),
        c,
        "PaymentRecorded",
        [1n, 1, memberId("m_test1"), REF(1), due - 10n, false],
      );
      await viem.assertions.emitWithArgs(
        c.write.recordPayment([1n, 1, memberId("m_test2"), REF(2), due + 10n]),
        c,
        "PaymentRecorded",
        [1n, 1, memberId("m_test2"), REF(2), due + 10n, true],
      );
    });
  });

  // ----------------------------------------------------- penutupan periode dan pencairan (T1)
  describe("closePeriod dan markPayout", () => {
    it("closePeriod ditolak bila iuran belum lengkap", async function () {
      const c = await deployStarted(2);
      await c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), 1700000000n]);
      await viem.assertions.revertWithCustomError(c.write.closePeriod([1n, 1]), c, "PeriodNotComplete");
    });

    it("closePeriod saat lengkap: ReadyPayout dan penerima sesuai jadwal", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await viem.assertions.emitWithArgs(c.write.closePeriod([1n, 1]), c, "PeriodClosed", [1n, 1, memberId("m_test1")]);
      assert.equal(await periodStatus(c, 1), PeriodStatus.ReadyPayout);
      // periode yang sudah ditutup tidak menerima iuran lagi
      await viem.assertions.revertWithCustomError(c.write.closePeriod([1n, 1]), c, "PeriodNotRunning");
    });

    it("markPayout ditolak bila iuran belum lengkap", async function () {
      const c = await deployStarted(2);
      await c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), 1700000000n]);
      await viem.assertions.revertWithCustomError(c.write.markPayout([1n, 1, PAYOUT(1)]), c, "PeriodNotComplete");
    });

    it("markPayout menutup periode sendiri, mencatat hash, dan membuka periode berikutnya", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await viem.assertions.emitWithArgs(c.write.markPayout([1n, 1, PAYOUT(1)]), c, "PayoutMarked", [
        1n,
        1,
        memberId("m_test1"),
        PAYOUT(1),
      ]);
      const p1 = await c.read.getPeriod([1n, 1]);
      assert.equal(p1.status, PeriodStatus.Done);
      assert.equal(p1.payoutRefHash, PAYOUT(1));
      assert.equal(await periodStatus(c, 2), PeriodStatus.Running);
      assert.equal((await c.read.getCircle([1n])).status, Status.Active);
    });

    it("markPayout setelah closePeriod juga berhasil", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await c.write.closePeriod([1n, 1]);
      await c.write.markPayout([1n, 1, PAYOUT(1)]);
      assert.equal(await periodStatus(c, 1), PeriodStatus.Done);
    });

    it("periode terakhir dicairkan: kelompok Completed, penerima sesuai urutan", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await c.write.markPayout([1n, 1, PAYOUT(1)]);
      await payPeriod(c, 2);
      await viem.assertions.emitWithArgs(c.write.markPayout([1n, 2, PAYOUT(2)]), c, "PayoutMarked", [
        1n,
        2,
        memberId("m_test2"),
        PAYOUT(2),
      ]);
      assert.equal(await periodStatus(c, 2), PeriodStatus.Done);
      assert.equal((await c.read.getCircle([1n])).status, Status.Completed);
    });

    it("pencairan dua kali ditolak; periode yang belum gilirannya ditolak", async function () {
      const c = await deployStarted(2);
      await viem.assertions.revertWithCustomError(c.write.markPayout([1n, 2, PAYOUT(2)]), c, "PeriodNotReady");
      await payPeriod(c, 1);
      await c.write.markPayout([1n, 1, PAYOUT(1)]);
      await viem.assertions.revertWithCustomError(c.write.markPayout([1n, 1, PAYOUT(9)]), c, "PeriodNotReady");
    });

    it("hash pencairan kosong ditolak", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await viem.assertions.revertWithCustomError(
        c.write.markPayout([1n, 1, stringToHex("", { size: 32 })]),
        c,
        "InvalidParams",
      );
    });

    it("hanya operator yang boleh menutup periode dan menandai pencairan", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      const [, other] = await viem.getWalletClients();
      await viem.assertions.revertWithCustomError(c.write.closePeriod([1n, 1], { account: other.account }), c, "NotOperator");
      await viem.assertions.revertWithCustomError(
        c.write.markPayout([1n, 1, PAYOUT(1)], { account: other.account }),
        c,
        "NotOperator",
      );
    });

    it("periode yang sudah Done tidak menerima iuran lagi", async function () {
      const c = await deployStarted(2);
      await payPeriod(c, 1);
      await c.write.markPayout([1n, 1, PAYOUT(1)]);
      await viem.assertions.revertWithCustomError(
        c.write.recordPayment([1n, 1, memberId("m_test1"), REF(99), 1700000000n]),
        c,
        "PeriodNotRunning",
      );
    });
  });

  // ------------------------------------------------------------------- penalti (T2)
  describe("penalti", () => {
    it("penaltyDue: 0 sebelum tenggat, denda setelahnya bagi yang belum bayar, 0 bagi yang sudah bayar", async function () {
      const c = await deployStarted(2);
      assert.equal(await c.read.penaltyDue([1n, 1, memberId("m_test1")]), 0n);
      await c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), 1700000000n]);
      await networkHelpers.time.increaseTo((await c.read.dueDate([1n, 1])) + 1n);
      assert.equal(await c.read.penaltyDue([1n, 1, memberId("m_test1")]), 0n); // sudah bayar
      assert.equal(await c.read.penaltyDue([1n, 1, memberId("m_test2")]), PENALTY_AMOUNT); // belum bayar
    });

    it("applyPenalty ditolak sebelum tenggat", async function () {
      const c = await deployStarted(2);
      await viem.assertions.revertWithCustomError(c.write.applyPenalty([1n, 1, memberId("m_test1")]), c, "NotLate");
    });

    it("applyPenalty setelah tenggat: dicatat sekali, boleh dipanggil siapa pun, seragam", async function () {
      const c = await deployStarted(2);
      await networkHelpers.time.increaseTo((await c.read.dueDate([1n, 1])) + 1n);
      const [, other] = await viem.getWalletClients();
      await viem.assertions.emitWithArgs(
        c.write.applyPenalty([1n, 1, memberId("m_test1")], { account: other.account }),
        c,
        "PenaltyApplied",
        [1n, 1, memberId("m_test1"), PENALTY_AMOUNT],
      );
      const pen = await c.read.getPenalty([1n, 1, memberId("m_test1")]);
      assert.equal(pen.applied, true);
      assert.equal(pen.amount, PENALTY_AMOUNT);
      // sekali per anggota per periode
      await viem.assertions.revertWithCustomError(c.write.applyPenalty([1n, 1, memberId("m_test1")]), c, "PenaltyAlreadyApplied");
      // anggota lain memperoleh denda yang sama besar
      await c.write.applyPenalty([1n, 1, memberId("m_test2")]);
      assert.equal((await c.read.getPenalty([1n, 1, memberId("m_test2")])).amount, PENALTY_AMOUNT);
    });

    it("applyPenalty ditolak bagi anggota yang sudah bayar", async function () {
      const c = await deployStarted(2);
      await c.write.recordPayment([1n, 1, memberId("m_test1"), REF(1), 1700000000n]);
      await networkHelpers.time.increaseTo((await c.read.dueDate([1n, 1])) + 1n);
      await viem.assertions.revertWithCustomError(c.write.applyPenalty([1n, 1, memberId("m_test1")]), c, "AlreadyPaid");
    });

    it("kelompok tanpa penalti (0%) tidak punya denda", async function () {
      const c = await deployStarted(2, 0);
      await viem.assertions.revertWithCustomError(c.write.applyPenalty([1n, 1, memberId("m_test1")]), c, "NoPenalty");
    });

    it("pembulatan ke atas sama dengan backend", async function () {
      const c = await viem.deployContract("LingkarPay");
      await c.write.createCircle([10001n, 2, 7, 5]); // 500,05 -> 501
      await c.write.addMember([1n, memberId("m_test1")]);
      await c.write.addMember([1n, memberId("m_test2")]);
      await c.write.startCircle([1n]);
      await networkHelpers.time.increaseTo((await c.read.dueDate([1n, 1])) + 1n);
      assert.equal(await c.read.penaltyDue([1n, 1, memberId("m_test1")]), 501n);
    });
  });

  // TODO(smart-contract, opsional dan terakhir)
  it.todo("kuorum tidak tercapai: keputusan tidak berlaku (propose/vote)");
});
