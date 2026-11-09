// Mengekspor alamat dan ABI hasil deploy Ignition ke contracts/deployments/ (dibaca worker dan frontend).
// Jalankan setelah `npm run deploy:sepolia`:  npm run export:sepolia
// CATATAN: path berkas Ignition di bawah mengikuti konvensi hardhat-ignition; verifikasi setelah deploy pertama.
import fs from "node:fs";

const chainId = process.env.CHAIN_ID ?? "11155111"; // Sepolia
const dir = `ignition/deployments/chain-${chainId}`;

const addresses = JSON.parse(fs.readFileSync(`${dir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const address = addresses["LingkarPayModule#LingkarPay"];
if (!address) throw new Error(`Alamat LingkarPay tidak ditemukan di ${dir}/deployed_addresses.json`);

const artifact = JSON.parse(fs.readFileSync(`${dir}/artifacts/LingkarPayModule#LingkarPay.json`, "utf8")) as { abi: unknown };

fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync("deployments/LingkarPay.abi.json", JSON.stringify(artifact.abi, null, 2) + "\n");
fs.writeFileSync(
  "deployments/sepolia.json",
  JSON.stringify(
    {
      network: "sepolia",
      chainId: Number(chainId),
      address,
      exportedAt: new Date().toISOString(),
      abiPath: "contracts/deployments/LingkarPay.abi.json",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Diekspor: ${address} (chain ${chainId}) ke deployments/`);
