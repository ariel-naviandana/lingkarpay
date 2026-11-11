// Membaca state satu kelompok LANGSUNG dari contract (bukan dari database), untuk membuktikan data tercatat on-chain.
// Pakai (PowerShell, dari folder contracts):
//   $env:LINGKARPAY_ADDRESS="0x..."; $env:CIRCLE_ID="15"; npm run inspect
// CIRCLE_ID = id kelompok ON-CHAIN (kolom circles.chain_circle_id di database backend).
// Jaringan: localhost (bawaan) atau HARDHAT_NETWORK=sepolia.
import { network } from "hardhat";
import { hexToString, type Hex } from "viem";

const address = process.env.LINGKARPAY_ADDRESS as Hex | undefined;
if (!address) throw new Error("Isi LINGKARPAY_ADDRESS (alamat contract hasil deploy)");
const circleId = BigInt(process.env.CIRCLE_ID ?? "1");

const { viem } = await network.create({ network: process.env.HARDHAT_NETWORK ?? "localhost" });
const c = await viem.getContractAt("LingkarPay", address);

const CIRCLE_STATUS = ["None", "Draft", "Active", "Completed"];
const PERIOD_STATUS = ["Scheduled", "Running", "ReadyPayout", "Done"];
const PROPOSAL_KIND = ["ClosePeriod", "ReplaceMember"];
const PROPOSAL_STATUS = ["None", "Open", "Approved", "Rejected", "Executed"];
const ref = (h: Hex) => hexToString(h, { size: 32 });

const circle = await c.read.getCircle([circleId]);
const members = await c.read.getMembers([circleId]);
console.log(`Kelompok #${circleId} di ${address}`);
console.log(
  `  status ${CIRCLE_STATUS[circle.status]} | iuran ${circle.contributionAmount} | ${circle.memberCount} anggota | ${circle.periodDays} hari | penalti ${circle.penaltyPct}%`,
);
console.log(`  urutan giliran: ${members.map(ref).join(" > ")}`);

for (let n = 1; n <= members.length; n++) {
  const p = await c.read.getPeriod([circleId, n]);
  const recipient = await c.read.recipientOf([circleId, n]);
  console.log(`\nPeriode ${n}: ${PERIOD_STATUS[p.status]} | lunas ${p.paidCount}/${members.length} | penerima ${ref(recipient)}`);
  if (p.payoutRefHash !== `0x${"0".repeat(64)}`) console.log(`  hash pencairan: ${p.payoutRefHash}`);
  for (const m of members) {
    const pay = await c.read.getPayment([circleId, n, m]);
    if (pay.paid) console.log(`  ${ref(m)}: lunas, refHash ${pay.refHash}`);
  }

  // Usulan kuorum untuk periode ini (bila ada)
  const proposalId = await c.read.proposalOfPeriod([circleId, n]);
  if (proposalId !== 0n) {
    const pr = await c.read.getProposal([proposalId]);
    console.log(
      `  usulan #${proposalId} (${PROPOSAL_KIND[pr.kind]}): ${PROPOSAL_STATUS[pr.status]} | setuju ${pr.approvals}, tolak ${pr.rejections}, kuorum ${await c.read.quorumOf([circleId])}`,
    );
    for (const m of members) {
      if (await c.read.hasVoted([proposalId, m])) console.log(`    suara tercatat: ${ref(m)}`);
    }
  }
}
