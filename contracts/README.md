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
