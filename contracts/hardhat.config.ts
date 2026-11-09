import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Mengikuti templat `npx hardhat --init` (Hardhat 3.21.2). Rahasia TIDAK ditulis di sini:
// SEPOLIA_RPC_URL dan SEPOLIA_PRIVATE_KEY dibaca dari variabel environment atau keystore Hardhat
// (`npx hardhat keystore set SEPOLIA_PRIVATE_KEY`). Hardhat tidak membaca file .env secara otomatis.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.34" },
      production: {
        version: "0.8.34",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")], // akun testnet khusus = operator contract
    },
  },
});
