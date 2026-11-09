// Membuat akun testnet khusus (alamat + private key) di komputer lokal.
// Jalankan: npx hardhat run scripts/new-account.ts
// Private key disimpan di .secrets/operator.key (di-.gitignore) dan TIDAK dicetak ke layar.
// Hanya untuk testnet. Jangan memakai akun ini untuk uang asli, dan jangan kirim key-nya ke chat.
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const file = ".secrets/operator.key";
if (fs.existsSync(file)) {
  const existing = privateKeyToAccount(fs.readFileSync(file, "utf8").trim() as `0x${string}`);
  console.log(`Akun sudah ada: ${existing.address}`);
  console.log(`(private key ada di ${file})`);
} else {
  const key = generatePrivateKey();
  fs.mkdirSync(".secrets", { recursive: true });
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  console.log(`Akun testnet baru: ${privateKeyToAccount(key).address}`);
  console.log(`Private key disimpan di ${file} (tidak dicetak).`);
}
console.log("Minta ETH Sepolia ke alamat di atas lewat faucet, lalu isi keystore:");
console.log("  npx hardhat keystore set SEPOLIA_PRIVATE_KEY   (tempel isi file .secrets/operator.key)");
