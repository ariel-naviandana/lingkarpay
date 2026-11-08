// KERANGKA konfigurasi Hardhat 3. Bila berbeda dengan hasil `npx hardhat --init`, ikuti hasil init.
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: { profiles: { default: { version: "0.8.28" } } },
  networks: {
    // Rahasia dibaca dari environment/keystore Hardhat, tidak pernah ditulis di sini.
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")], // akun testnet khusus, bukan akun pribadi
    },
  },
});
