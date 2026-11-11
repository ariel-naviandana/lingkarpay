/**
 * Modul chain (jalur smart contract): worker yang membaca outbox dan mencatatnya ke contract LingkarPay.
 * Dijalankan: npm run chain:worker   (butuh: npm i, Postgres, backend yang sudah memproses pembayaran)
 *
 * Konfigurasi di .env (divalidasi di src/config.schema.ts):
 *   CHAIN_NAME=hardhat|sepolia, CHAIN_RPC_URL, OPERATOR_PRIVATE_KEY (akun testnet khusus), LINGKARPAY_ADDRESS
 * Akun OPERATOR_PRIVATE_KEY harus akun yang men-deploy contract (menjadi `operator`).
 *
 * Idempoten: bila worker mati di tengah jalan, percobaan ulang melanjutkan dari state contract
 * (circleIdByRef, getMembers, getPayment, getPeriod) dan tidak membuat catatan ganda.
 */
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";
import { config } from "../config.js";
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
  "function createCircle(bytes32 externalRef, uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct) returns (uint256)",
  "function addMember(uint256 circleId, bytes32 memberId)",
  "function startCircle(uint256 circleId)",
  "function recordPayment(uint256 circleId, uint32 periodNo, bytes32 memberId, bytes32 refHash, uint64 paidAt)",
  "function closePeriod(uint256 circleId, uint32 periodNo)",
  "function markPayout(uint256 circleId, uint32 periodNo, bytes32 payoutRefHash)",
  "function circleIdByRef(bytes32 externalRef) view returns (uint256)",
  "function getCircle(uint256 circleId) view returns ((uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct, uint64 startTime, uint8 status, bytes32 externalRef))",
  "function getMembers(uint256 circleId) view returns (bytes32[])",
  "function getPeriod(uint256 circleId, uint32 periodNo) view returns ((uint8 status, uint32 paidCount, bytes32 payoutRefHash))",
  "function getPayment(uint256 circleId, uint32 periodNo, bytes32 memberId) view returns ((bool paid, uint64 paidAt, bytes32 refHash))",
  "event CircleCreated(uint256 indexed circleId, bytes32 indexed externalRef, uint256 contributionAmount, uint32 memberCount, uint32 periodDays, uint16 penaltyPct)",
  "event CircleStarted(uint256 indexed circleId, uint64 startTime)",
  "event PaymentRecorded(uint256 indexed circleId, uint32 indexed periodNo, bytes32 indexed memberId, bytes32 refHash, uint64 paidAt, bool late)",
  "event PayoutMarked(uint256 indexed circleId, uint32 indexed periodNo, bytes32 recipient, bytes32 payoutRefHash)",
]);

// Status di contract (enum): CircleStatus None=0 Draft=1 Active=2 Completed=3; PeriodStatus Scheduled=0 Running=1 ReadyPayout=2 Done=3
const CIRCLE_DRAFT = 1;
const PERIOD_DONE = 3;

const chain = config.CHAIN_NAME === "hardhat" ? hardhat : sepolia;
const RPC_URL = config.CHAIN_RPC_URL;
const PRIVATE_KEY = config.OPERATOR_PRIVATE_KEY as Hex | undefined;
const CONTRACT = config.LINGKARPAY_ADDRESS as Hex | undefined;
if (!RPC_URL || !PRIVATE_KEY || !CONTRACT) {
  throw new Error("Isi CHAIN_RPC_URL, OPERATOR_PRIVATE_KEY, dan LINGKARPAY_ADDRESS di .env");
}

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

/** memberRef samaran dari backend (mis. "m_ab12cd34") menjadi bytes32. */
const toMemberId = (ref: string): Hex => stringToHex(ref, { size: 32 });

/** Referensi eksternal kelompok: hash tetap dari id kelompok di database. Dipakai contract untuk mencegah kelompok ganda. */
const circleRef = (circleDbId: number): Hex => keccak256(stringToHex(`lingkarpay:circle:${circleDbId}`));

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Mencari hash transaksi sebuah event yang baru terjadi (untuk pemulihan setelah worker mati di tengah jalan).
// Rentang dipecah kecil (10 blok) agar tidak ditolak penyedia RPC gratis; hanya dipakai pada kasus pemulihan.
const LOG_CHUNK = 10n;
const LOOKBACK_BLOCKS = 300n;
async function findRecentTx(
  eventName: "CircleStarted" | "PaymentRecorded" | "PayoutMarked",
  args: Record<string, unknown>,
): Promise<Hex | null> {
  const latest = await publicClient.getBlockNumber();
  for (let i = 0n; i < LOOKBACK_BLOCKS; i += LOG_CHUNK) {
    const to = latest - i;
    if (to < 0n) break;
    const from = to >= LOG_CHUNK - 1n ? to - (LOG_CHUNK - 1n) : 0n;
    const logs = (await publicClient.getContractEvents({
      address: CONTRACT!,
      abi,
      eventName,
      args,
      fromBlock: from,
      toBlock: to,
    } as never)) as unknown as Array<{ transactionHash: Hex }>;
    if (logs.length > 0) return logs[0]!.transactionHash;
    if (from === 0n) break;
  }
  return null;
}

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
      const ref = circleRef(p.circleId);

      // 1) Kelompok: pakai yang sudah ada (ref sama) atau buat baru. Tidak pernah membuat ganda.
      let chainId = await publicClient.readContract({ address: CONTRACT!, abi, functionName: "circleIdByRef", args: [ref] });
      if (chainId === 0n) {
        const created = await send("createCircle", [ref, BigInt(p.contributionAmount), p.memberCount, p.periodDays, p.penaltyPct]);
        const logs = parseEventLogs({ abi, logs: created.receipt.logs, eventName: "CircleCreated" });
        const newId = logs[0]?.args.circleId;
        if (newId === undefined) throw new Error("Event CircleCreated tidak ditemukan");
        chainId = newId;
      }

      // 2) Anggota sesuai urutan giliran terkunci. Lanjutkan dari yang sudah ada di chain.
      const wanted = [...p.members].sort((x, y) => x.turnOrder - y.turnOrder).map((m) => toMemberId(m.memberRef));
      const present = await publicClient.readContract({ address: CONTRACT!, abi, functionName: "getMembers", args: [chainId] });
      for (let i = 0; i < present.length; i++) {
        if (!same(present[i]!, wanted[i] ?? "")) throw new Error("Anggota di chain tidak sesuai urutan giliran terkunci");
      }
      for (let i = present.length; i < wanted.length; i++) await send("addMember", [chainId, wanted[i]]);

      // 3) Mulai kelompok bila masih Draft; bila sudah dimulai, ambil hash transaksinya dari event.
      const circle = await publicClient.readContract({ address: CONTRACT!, abi, functionName: "getCircle", args: [chainId] });
      let startHash: Hex | null;
      if (circle.status === CIRCLE_DRAFT) {
        startHash = (await send("startCircle", [chainId])).hash;
      } else {
        startHash = await findRecentTx("CircleStarted", { circleId: chainId });
      }
      if (!startHash) {
        throw new Error("Kelompok sudah dimulai di chain tetapi hash transaksi startCircle tidak ditemukan; periksa di Etherscan");
      }
      await markCircleCreated(job.id, chainId.toString(), startHash);
      return;
    }

    case "recordPayment": {
      const p = job.payload as RecordPaymentPayload;
      // claimJobs menjamin circleChainId sudah terisi (kelompok sudah on-chain).
      if (p.circleChainId === null) throw new Error("circleChainId kosong (kelompok belum on-chain)");
      const chainId = BigInt(p.circleChainId);
      const memberId = toMemberId(p.memberRef);

      // Sudah tercatat (transaksi sebelumnya sebenarnya berhasil)? Perlakukan sebagai sukses bila refHash sama.
      const existing = await publicClient.readContract({
        address: CONTRACT!,
        abi,
        functionName: "getPayment",
        args: [chainId, p.periodNo, memberId],
      });
      if (existing.paid) {
        if (!same(existing.refHash, p.refHash)) throw new Error("Iuran ini sudah tercatat di chain dengan refHash yang berbeda");
        const hash = await findRecentTx("PaymentRecorded", { circleId: chainId, periodNo: p.periodNo, memberId });
        if (!hash) throw new Error("Iuran sudah tercatat di chain tetapi hash transaksinya tidak ditemukan; periksa di Etherscan");
        await markJobConfirmed(job.id, hash);
        return;
      }

      const { hash } = await send("recordPayment", [chainId, p.periodNo, memberId, p.refHash as Hex, BigInt(p.paidAt)]);
      await markJobConfirmed(job.id, hash);
      return;
    }

    case "markPayout": {
      const p = job.payload as MarkPayoutPayload;
      if (p.circleChainId === null) throw new Error("circleChainId kosong (kelompok belum on-chain)");
      const chainId = BigInt(p.circleChainId);

      // Sudah dicairkan di chain? Sukses bila hash pencairan sama.
      const period = await publicClient.readContract({ address: CONTRACT!, abi, functionName: "getPeriod", args: [chainId, p.periodNo] });
      if (period.status === PERIOD_DONE) {
        if (!same(period.payoutRefHash, p.payoutRefHash)) throw new Error("Periode ini sudah dicairkan di chain dengan hash yang berbeda");
        const hash = await findRecentTx("PayoutMarked", { circleId: chainId, periodNo: p.periodNo });
        if (!hash) throw new Error("Pencairan sudah tercatat di chain tetapi hash transaksinya tidak ditemukan; periksa di Etherscan");
        await markJobConfirmed(job.id, hash);
        return;
      }

      // markPayout menutup periode sendiri dan butuh semua iuran sudah tercatat on-chain. Bila masih ada job
      // recordPayment yang diulang, contract menolak (PeriodNotComplete); job diulang otomatis dengan jeda.
      const { hash } = await send("markPayout", [chainId, p.periodNo, p.payoutRefHash as Hex]);
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

// Belum ada: shutdown rapi (SIGINT), metrik, dan beberapa worker serentak (nonce satu akun dikirim berurutan).
async function main() {
  console.log(`worker chain mulai di ${chain.name}. operator ${account.address}, contract ${CONTRACT}`);
  for (;;) {
    const n = await tick().catch((e) => {
      console.error("tick gagal:", e);
      return 0;
    });
    await new Promise((r) => setTimeout(r, n > 0 ? 500 : 5000));
  }
}

void main();
