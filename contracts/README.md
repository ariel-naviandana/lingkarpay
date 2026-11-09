# contracts — jalur smart contract

Folder ini milik jalur smart contract. Kerangka awal sudah disiapkan (lihat bagian "Kerangka awal" di bawah). Disarankan Hardhat 3 + Solidity + `viem`, jaringan Ethereum Sepolia (ETH uji saja).

## Tugas
Contract LingkarPay, tes unit, deploy ke Sepolia, simpan alamat dan ABI, dokumentasi fungsi. Modul chain (worker TypeScript) ada di `apps/api/src/chain/` (lihat README di sana).

## Fungsi (dari proposal, Tabel 17)
`createCircle`, `addMember`, `startCircle`, `recordPayment`, `applyPenalty`, `closePeriod`, `markPayout`, fungsi baca (`getCircle`, `getPeriod`, `getMemberStatus`), event untuk tiap perubahan penting. Kuorum (`propose`/`vote`) opsional dan dikerjakan terakhir.

## Aturan yang harus ditegakkan
Parameter terkunci setelah `startCircle`; penerima ditentukan jadwal (bukan operator); satu iuran satu catatan (pencatatan ganda ditolak); penalti dihitung kontrak, seragam; pencairan hanya bisa ditandai siap bila syarat terpenuhi. Hanya akun operator (penanda tangan backend) yang boleh mencatat.

## Data yang dikirim backend (antarmuka outbox)
Dari `chain_jobs.payload` (lihat `docs/DESIGN.md` bagian 7). Tanpa data pribadi.
```
createCircle:   circleId, contributionAmount, memberCount, periodDays, penaltyPct,
                members[ { memberRef ("m_xxxxxxxx"), turnOrder } ]  (urutan giliran terkunci)
recordPayment:  circleId, circleChainId, periodNo, memberRef,
                refHash (bytes32, Keccak-256), paidAt (detik UNIX)
markPayout:     circleId, circleChainId, periodNo, recipientMemberRef,
                payoutRefHash (bytes32), recipientAccountHash (bytes32|null), amount (rupiah bulat)
```
Satu job `createCircle` memetakan ke `createCircle` + `addMember` + `startCircle`. Id kelompok yang dikembalikan chain dilaporkan ke backend lewat `markCircleCreated` agar job pembayaran kelompok itu dibuka.

Rancang tipe contract agar cocok: `memberRef` sebagai `bytes32`/`string`, `refHash` sebagai `bytes32`, nominal rupiah sebagai `uint256`. Jangan menyimpan nama, email, atau nomor rekening on-chain.

## Hasil deploy
Simpan di `contracts/deployments/sepolia.json` (dipakai modul chain dan portal verifikasi):
```json
{ "network": "sepolia", "chainId": 11155111, "address": "0x...", "deployedAt": "2026-11-xx", "abiPath": "contracts/artifacts/.../LingkarPay.json" }
```
Salin ABI-nya juga ke folder ini bila artefak build tidak di-commit.

## Rahasia
Private key penanda tangan (akun testnet khusus) dan URL RPC hanya di `.env` (`SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`). Jangan pernah di-commit atau dikirim ke chat. Contoh nama variabel boleh di `.env.example`.

## Struktur yang disarankan
```
contracts/
├── contracts/LingkarPay.sol
├── test/                 tes unit (aturan terkunci, penolakan pencatatan ganda, penalti, penerima sesuai urutan, dst.)
├── scripts/ atau ignition/   deploy
├── deployments/          sepolia.json
└── .env.example
```
Skenario tes yang diminta proposal (Tabel 19): pencatatan oleh non-operator ditolak, pencatatan dua kali ditolak, pembayaran lewat tenggat kena penalti, penutupan periode saat iuran belum lengkap tanpa kuorum ditolak, penerima sesuai urutan terkunci, perubahan parameter setelah mulai ditolak, kuorum tidak tercapai tidak berlaku.

## Kerangka awal (sudah disesuaikan dengan Hardhat 3.21.2)
Dibuat dari hasil `npx hardhat --init` (templat `node-test-runner-viem`). **Belum dikompilasi di komputer pengembang.** Cara menjalankan (Windows, dari folder `contracts`):
```powershell
cd C:\coding\lingkarpay\contracts
npm install
npm run build        # kompilasi Solidity (compiler 0.8.34 diunduh pertama kali)
npm test             # 5 tes dasar harus hijau; sisanya it.todo
```
Hardhat 3 mendukung Node 22 (min. 22.10) dan 24; Node 23 menghasilkan peringatan `EBADENGINE` pada beberapa dependensi. Bila ada masalah aneh, pindah ke Node 22 LTS (mis. dengan nvm-windows).

| File | Isi | Status |
|---|---|---|
| `contracts/LingkarPay.sol` | Struct, event, error, kontrol akses operator, `createCircle`, `addMember`, `startCircle`, `recordPayment`, fungsi baca, `dueDate`, `recipientOf`, `penaltyDue` | Lengkap kecuali kuorum |
| `test/LingkarPay.test.ts` | Tes kelompok, pembayaran, penutupan periode, pencairan, dan penalti; kuorum masih `it.todo` | Ada |
| `ignition/modules/LingkarPay.ts` | Modul deploy (Ignition) | Ada |
| `scripts/new-account.ts` | Membuat akun testnet khusus; private key ke `.secrets/` (tidak dicetak) | Ada |
| `scripts/export-deployment.ts` | Mengekspor alamat dan ABI ke `deployments/` | Ada (verifikasi path setelah deploy pertama) |
| `hardhat.config.ts`, `package.json`, `tsconfig.json` | Mengikuti templat Hardhat 3.21.2 | Ada |

### Rahasia dan deploy ke Sepolia
Hardhat tidak membaca `.env`. Variabel konfigurasi `SEPOLIA_RPC_URL` dan `SEPOLIA_PRIVATE_KEY` diisi lewat keystore Hardhat (disarankan) atau variabel environment:
```powershell
npx hardhat run scripts/new-account.ts          # buat akun testnet; catat ALAMATNYA
# minta ETH Sepolia ke alamat itu lewat faucet
npx hardhat keystore set SEPOLIA_RPC_URL         # tempel URL RPC (Alchemy/Infura)
npx hardhat keystore set SEPOLIA_PRIVATE_KEY     # tempel isi .secrets/operator.key
npm run deploy:sepolia
npm run export:sepolia                           # tulis deployments/sepolia.json dan ABI
```
Akun yang sama harus dipakai worker (`OPERATOR_PRIVATE_KEY` di `apps/api/.env`), karena akun deploy menjadi `operator`.

### Status tahapan
| Tahap | Pekerjaan | Status |
|---|---|---|
| T0 | Lingkungan dan kompilasi kerangka | Selesai: kompilasi sukses dan 5 tes dasar hijau (9 Nov) |
| T1 | `closePeriod` dan `markPayout` + tes | Ditulis, menunggu `npm test` |
| T2 | `applyPenalty` (denda terutang, audit) + tes | Ditulis, menunggu `npm test` |
| T3 | Tes skenario proposal Tabel 19 | Ditulis, menunggu `npm test` |
| T4 | Deploy ke Sepolia, ekspor alamat dan ABI | Belum |
| T5 | Worker chain terhadap node lokal | Belum (kerangka `worker.example.ts` sudah disesuaikan) |
| T6 | Uji ujung ke ujung di Sepolia | Belum |
| T7 | Kuorum `propose`/`vote` (opsional) | Belum; `it.todo` |
| T8 | Dokumentasi | Sebagian |

Keputusan desain yang sudah diterapkan: `markPayout` menutup periode sendiri (butuh semua iuran tercatat on-chain), `applyPenalty` mencatat denda terutang tanpa memindahkan uang, periode berikutnya dibuka di `markPayout`.

### Konvensi data
`memberId` (bytes32) = `memberRef` samaran dari backend diubah dengan `stringToHex(ref, { size: 32 })` (viem). Nominal dalam rupiah bulat (`uint256`). `circleId` on-chain berbeda dari `circleId` database; hubungannya disimpan backend di `circles.chain_circle_id` lewat `markCircleCreated`.

## Keputusan desain (disepakati 9 November 2026)
| # | Keputusan |
|---|---|
| 1 | `markPayout` menutup periode sendiri bila masih `Running` dan semua iuran lunas. Worker cukup memanggil satu fungsi. `closePeriod` tetap ada untuk jalur kuorum. |
| 2 | `applyPenalty` mencatat denda yang *terutang* (sekali per anggota per periode, boleh dipanggil siapa pun setelah tenggat) sebagai catatan audit, dengan rumus yang sama dengan backend. Contract tidak memindahkan uang. |
| 3 | Kuorum (`propose`/`vote`) dikerjakan terakhir dan opsional: hanya "tunda pencairan" dan "ganti anggota"; suara diteruskan backend. |
| 4 | Periode berikutnya dibuka di dalam `markPayout`, seperti yang sudah dikerjakan backend. |
| 5 | Worker idempoten: simpan id kelompok on-chain begitu event terbaca, dan cek sebelum membuat kelompok ulang bila worker restart. |

## Rencana tahapan
T0 siapkan lingkungan dan kompilasi kerangka; T1 `closePeriod` + `markPayout`; T2 `applyPenalty`; T3 tes sesuai proposal Tabel 19; T4 deploy Sepolia; T5 worker terhadap node lokal; T6 uji ujung ke ujung di Sepolia; T7 kuorum (opsional); T8 dokumentasi. Target: T5 dapat ditunjukkan sebelum progress report (sebelum 24 November), pembekuan 25 November.
