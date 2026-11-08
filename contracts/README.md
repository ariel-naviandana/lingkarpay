# contracts — jalur smart contract

Belum dimulai. Folder ini milik jalur smart contract. Disarankan Hardhat 3 + Solidity + `viem`, jaringan Ethereum Sepolia (ETH uji saja).

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

## Kerangka awal (sudah disiapkan)
Folder ini berisi kerangka supaya jalur smart contract punya titik mulai. **Belum dikompilasi dan belum diuji.** Versi paket dan bentuk `hardhat.config.ts` ditebak dari dokumentasi Hardhat 3; jalankan `npx hardhat --init` di folder kosong, bandingkan hasilnya, lalu sesuaikan.

| File | Isi | Status |
|---|---|---|
| `contracts/LingkarPay.sol` | Struct, event, error, kontrol akses operator, `createCircle`, `addMember`, `startCircle`, `recordPayment`, fungsi baca, `dueDate`, `recipientOf`, `penaltyDue` | Inti ada |
| `test/LingkarPay.test.ts` | 4 tes dasar (urutan anggota, non-operator, pencatatan ganda, parameter terkunci) + daftar `it.todo` | Kerangka |
| `scripts/deploy.ts` | Deploy dan simpan alamat + ABI ke `deployments/` | Kerangka |
| `hardhat.config.ts`, `package.json`, `.env.example` | Konfigurasi Sepolia (rahasia dari environment) | Kerangka |

### Yang menjadi pekerjaan jalur ini (TODO)
Cari `TODO(smart-contract)` di `LingkarPay.sol`:
1. `applyPenalty`: denda keterlambatan seragam, sekali per anggota per periode (rumus sama dengan `penaltyDue`).
2. `closePeriod`: syarat semua lunas atau kuorum; status `ReadyPayout`; penerima ditentukan jadwal.
3. `markPayout`: simpan `payoutRefHash`, periode `Done`, buka periode berikutnya, kelompok `Completed` di periode terakhir.
4. Kuorum `propose`/`vote` (opsional, terakhir).
5. Tes untuk semua skenario di bagian "Struktur yang disarankan", deploy ke Sepolia, simpan `deployments/sepolia.json`.
6. Keputusan desain: apakah `markPayout` menutup periode sendiri (supaya worker tidak perlu memanggil `closePeriod` lebih dulu)? Backend hanya punya job `markPayout`. Putuskan bersama jalur payment gateway.

### Konvensi data
`memberId` (bytes32) = `memberRef` samaran dari backend diubah dengan `stringToHex(ref, { size: 32 })` (viem). Nominal dalam rupiah bulat (`uint256`). `circleId` on-chain berbeda dari `circleId` database; hubungannya disimpan backend di `circles.chain_circle_id` lewat `markCircleCreated`.
