// KERANGKA skrip deploy ke Sepolia. Sesuaikan dengan versi Hardhat yang terpasang
// (alternatif resmi: Hardhat Ignition). Jalankan: npx hardhat run scripts/deploy.ts --network sepolia
import fs from "node:fs";
import { network } from "hardhat";

const { viem, networkName } = await network.connect();
const publicClient = await viem.getPublicClient();

const contract = await viem.deployContract("LingkarPay");
console.log(`LingkarPay di ${networkName}: ${contract.address}`);

// Simpan alamat dan ABI untuk modul chain (apps/api/src/chain) dan portal verifikasi (apps/web).
const artifactPath = "artifacts/contracts/LingkarPay.sol/LingkarPay.json";
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync("deployments/LingkarPay.abi.json", JSON.stringify(artifact.abi, null, 2));
fs.writeFileSync(
  `deployments/${networkName}.json`,
  JSON.stringify(
    {
      network: networkName,
      chainId: await publicClient.getChainId(),
      address: contract.address,
      deployedAt: new Date().toISOString(),
      abiPath: "contracts/deployments/LingkarPay.abi.json",
    },
    null,
    2,
  ),
);
