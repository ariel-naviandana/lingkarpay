/**
 * KERANGKA modul chain (jalur smart contract). BELUM dikompilasi dan belum diuji.
 *
 * Cara memakai:
 *   1. npm i viem                      (di apps/api)
 *   2. ganti nama file ini menjadi worker.ts (tsconfig mengecualikan *.example.ts agar typecheck tetap hijau)
 *   3. tambahkan skrip:  "chain:worker": "tsx src/chain/worker.ts"
 *   4. isi .env: SEPOLIA_RPC_URL, OPERATOR_PRIVATE_KEY (akun testnet khusus), LINGKARPAY_ADDRESS
 *
 * Yang SUDAH ada : loop claim → kirim → konfirmasi, penanganan tiga jenis job, pelaporan hasil ke outbox.
 * Yang TODO      : lihat penanda TODO(smart-contract) di bawah.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  claimJobs,
  markCircleCreated,
  markJobConfirmed,
  markJobFailed,
  type ChainJob,
  type CreateCirclePayload,
  type MarkPayoutPayload,
  type RecordPaymentPayload,
} from "../services/outbox.js";

// ABI minimal dalam bentuk teks (cukup untuk worker). Sesuaikan bila contract berubah,
// atau impor ABI lengkap dari contracts/deployments/LingkarPay.abi.json.
const abi = parseAbi([
  "function createCircle(uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct) returns (uint256)",
  "function addMember(uint256 circleId, bytes32 memberId)",
  "function startCircle(uint256 circleId)",
  "function recordPayment(uint256 circleId, uint32 periodNo, bytes32 memberId, bytes32 refHash, uint64 paidAt)",
  "function closePeriod(uint256 circleId, uint32 periodNo)",
  "function markPayout(uint256 circleId, uint32 periodNo, bytes32 payoutRefHash)",
  "event CircleCreated(uint256 indexed circleId, uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct)",
]);

// TODO(smart-contract): pindahkan ke src/config.schema.ts (divalidasi zod) seperti variabel lain.
const RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
const CONTRACT = process.env.LINGKARPAY_ADDRESS as Hex | undefined;
if (!RPC_URL || !PRIVATE_KEY || !CONTRACT) {
  throw new Error("Isi SEPOLIA_RPC_URL, OPERATOR_PRIVATE_KEY, dan LINGKARPAY_ADDRESS di .env");
}

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32. */
const toMemberId = (ref: string): Hex => stringToHex(ref, { size: 32 });

/** Kirim satu transaksi dan tunggu receipt. Dikirim berurutan sehingga nonce aman. */
async function send(functionName: "createCircle" | "addMember" | "startCircle" | "recordPayment" | "closePeriod" | "markPayout", args: readonly unknown[]) {
  const hash = await wallet.writeContract({ address: CONTRACT!, abi, functionName, args } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaksi ${functionName} gagal (reverted): ${hash}`);
  return { hash, receipt };
}

async function handle(job: ChainJob): Promise<void> {
  switch (job.kind) {
    case "createCircle": {
      const p = job.payload as CreateCirclePayload;
      // TODO(smart-contract): idempoten. Bila worker mati di tengah jalan, percobaan ulang akan membuat
      // kelompok ganda di chain. Simpan progres (mis. circleId on-chain sementara) atau cek dulu event.
      const created = await send("createCircle", [BigInt(p.contributionAmount), p.memberCount, p.periodDays, p.penaltyPct]);
      const logs = parseEventLogs({ abi, logs: created.receipt.logs, eventName: "CircleCreated" });
      const circleId = logs[0]?.args.circleId;
      if (circleId === undefined) throw new Error("Event CircleCreated tidak ditemukan");

      // Anggota ditambahkan sesuai urutan giliran terkunci.
      for (const m of [...p.members].sort((a, b) => a.turnOrder - b.turnOrder)) {
        await send("addMember", [circleId, toMemberId(m.memberRef)]);
      }
      const started = await send("startCircle", [circleId]);
      await markCircleCreated(job.id, circleId.toString(), started.hash);
      return;
    }

    case "recordPayment": {
      const p = job.payload as RecordPaymentPayload;
      // claimJobs menjamin circleChainId sudah terisi (kelompok sudah on-chain).
      if (p.circleChainId === null) throw new Error("circleChainId kosong (kelompok belum on-chain)");
      // TODO(smart-contract): bila contract menolak karena "AlreadyRecorded" (tx sebelumnya sebenarnya
      // berhasil), perlakukan sebagai sukses: baca receipt/event lalu markJobConfirmed.
      const { hash } = await send("recordPayment", [
        BigInt(p.circleChainId),
        p.periodNo,
        toMemberId(p.memberRef),
        p.refHash as Hex,
        BigInt(p.paidAt),
      ]);
      await markJobConfirmed(job.id, hash);
      return;
    }

    case "markPayout": {
      const p = job.payload as MarkPayoutPayload;
      if (p.circleChainId === null) throw new Error("circleChainId kosong (kelompok belum on-chain)");
      // TODO(smart-contract): backend hanya mengirim job markPayout. Tutup periode dulu (closePeriod),
      // atau ubah contract agar markPayout menutup periode sendiri. Lihat contracts/README.md.
      await send("closePeriod", [BigInt(p.circleChainId), p.periodNo]);
      const { hash } = await send("markPayout", [BigInt(p.circleChainId), p.periodNo, p.payoutRefHash as Hex]);
      await markJobConfirmed(job.id, hash);
      return;
    }
  }
}

async function tick(): Promise<number> {
  const jobs = await claimJobs(5); // createCircle didahulukan; job pembayaran menunggu kelompok on-chain
  for (const job of jobs) {
    try {
      await handle(job);
      console.log(`job ${job.id} (${job.kind}) selesai`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Jangan mencatat key atau URL RPC berkunci di pesan error.
      const { willRetry } = await markJobFailed(job.id, message.slice(0, 300));
      console.error(`job ${job.id} (${job.kind}) gagal, ${willRetry ? "akan diulang" : "gagal permanen"}: ${message}`);
    }
  }
  return jobs.length;
}

// TODO(smart-contract): shutdown rapi (SIGINT), metrik, dan penanganan nonce bila ada beberapa worker.
async function main() {
  console.log(`worker chain mulai. operator ${account.address}, contract ${CONTRACT}`);
  for (;;) {
    const n = await tick().catch((e) => {
      console.error("tick gagal:", e);
      return 0;
    });
    await new Promise((r) => setTimeout(r, n > 0 ? 500 : 5000));
  }
}

void main();
