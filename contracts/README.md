# contracts — jalur smart contract

Contract LingkarPay (Solidity, Hardhat 3, `viem`) di Ethereum Sepolia. Aturan arisan ditegakkan contract; **uang tidak disimpan di contract** (arsitektur pilihan A: rupiah tetap di payment gateway, contract hanya aturan dan catatan yang bisa diperiksa semua orang).

**Status (11 November 2026):** contract lengkap dan dites (40 test lulus), ter-deploy di Sepolia (v2), dan terbukti end to end dengan backend dan Midtrans sandbox. Bukti: `docs/BUKTI_SEPOLIA.md`.

| | |
|---|---|
| Alamat (v2, final) | `0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2` |
| Etherscan | https://sepolia.etherscan.io/address/0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2 |
| Operator | `0xA21603A66BD42EE94C705c55da58c64497377193` (akun testnet khusus) |
| Alamat dan ABI | `deployments/sepolia.json`, `deployments/LingkarPay.abi.json` |
| Verifikasi kode | Terverifikasi di Etherscan (Exact Match), Blockscout, dan Sourcify; lihat bagian Verifikasi kode contract |
| Deploy lama (v1) | `0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0`, arsip di `deployments/sepolia-v1.json` |

Modul chain (worker TypeScript) ada di `apps/api/src/chain/` (lihat README di sana).

## Fungsi
| Kelompok | Fungsi | Catatan |
|---|---|---|
| Kelompok | `createCircle(externalRef, iuran, anggota, hari, penaltiPct)`, `addMember`, `startCircle` | `externalRef` (hash id kelompok di database) membuat pembuatan idempoten: referensi ganda ditolak (`RefAlreadyUsed`), dan `circleIdByRef` memberi id kelompok bila sudah ada. Setelah `startCircle`, anggota dan parameter terkunci |
| Pembayaran | `recordPayment(circleId, periodNo, memberId, refHash, paidAt)` | Satu iuran satu catatan; event menandai terlambat (`late`) berdasarkan tenggat |
| Penalti | `applyPenalty`, `penaltyDue` | Mencatat denda terutang (audit; contract tidak memindahkan uang), sekali per anggota per periode, boleh dipanggil siapa pun setelah tenggat. Rumus `ceil(iuran x persen / 100)` sama dengan backend |
| Periode dan pencairan | `closePeriod`, `markPayout` | `markPayout` menutup periode sendiri (butuh semua iuran lunas atau keputusan kuorum), menyimpan hash pencairan, membuka periode berikutnya, dan menutup kelompok di periode terakhir |
| Kuorum | `proposeClosePeriod`, `proposeReplaceMember`, `vote`, `executeProposal` | Lihat bagian Kuorum |
| Baca | `getCircle`, `getMembers`, `getPeriod`, `getPayment`, `getPenalty`, `getProposal`, `hasVoted`, `dueDate`, `recipientOf`, `quorumOf`, `circleIdByRef`, `proposalOfPeriod` | |

Hanya `operator` (akun penanda tangan backend) yang boleh mencatat; membaca dan `applyPenalty` terbuka untuk siapa pun.

## Aturan yang ditegakkan (semuanya dites)
Parameter terkunci setelah `startCircle`; penerima ditentukan jadwal (urutan giliran terkunci), bukan operator; satu iuran satu catatan; penalti seragam; pencairan hanya bila semua lunas atau disetujui kuorum; kelompok dan usulan tidak bisa dibuat ganda. Skenario proposal Tabel 19 semuanya punya tes: pencatatan oleh non-operator ditolak, pencatatan dua kali ditolak, pembayaran lewat tenggat kena penalti, penutupan periode tanpa kuorum ditolak, penerima sesuai urutan terkunci, perubahan parameter setelah mulai ditolak, kuorum tidak tercapai tidak berlaku.

## Kuorum
Dua jenis usulan, keduanya hanya operasional (nominal, periode, penalti, dan urutan giliran tidak bisa diubah kuorum):

| Usulan | Fungsi | Efek bila disetujui |
|---|---|---|
| Tutup periode meski iuran belum lengkap | `proposeClosePeriod(circleId, periodNo)` | Periode berstatus `ReadyPayout`, pencairan boleh jalan |
| Ganti anggota yang mundur | `proposeReplaceMember(circleId, oldMember, newMember)` | Pengganti mewarisi giliran; iuran yang sudah tercatat di periode berjalan ikut pindah. Ditolak bila giliran anggota itu sudah dicairkan |

Aturan: kuorum = mayoritas mutlak (`anggota / 2 + 1`); `vote(proposalId, memberId, approve)` satu anggota satu suara (diteruskan backend setelah autentikasi, karena anggota tidak memegang dompet); disetujui saat setuju >= kuorum, ditolak bila kuorum mustahil tercapai; batas voting 3 hari (`VOTING_PERIOD`); `executeProposal` hanya untuk usulan yang disetujui, jadi usulan yang tidak mencapai kuorum tidak berlaku. Satu periode hanya boleh punya satu usulan tutup periode yang masih berlaku (`ProposalExists`; `proposalOfPeriod` memberi id-nya).

Terhubung ke backend untuk **usulan tutup periode** (endpoint, tabel, dan job outbox; lihat `docs/API.md`). **Ganti anggota** hanya ada di contract dan tes, belum di backend, karena penggantian anggota di database menyentuh tagihan, order, dan checkout.

## Data yang dikirim backend (antarmuka outbox)
Dari `chain_jobs.payload` (lihat `docs/DESIGN.md` bagian 7). Tanpa data pribadi. Konvensi: `memberId` (bytes32) = `memberRef` samaran diubah dengan `stringToHex(ref, { size: 32 })` (viem); `externalRef` = `keccak256("lingkarpay:circle:<id database>")`; nominal rupiah bulat (`uint256`); `circleId` on-chain berbeda dari id database dan disimpan di `circles.chain_circle_id`.

## Menjalankan (Windows, dari folder `contracts`)
```powershell
npm install
npm run build        # kompilasi (solc 0.8.34 diunduh pertama kali)
npm test             # 40 test lulus
```
Hardhat 3 mendukung Node 22 (min. 22.10) dan 24; Node 23 menghasilkan peringatan `EBADENGINE` (instalasi tetap berjalan). `npm test` memaksa jaringan simulasi, jadi aman walau variabel `HARDHAT_NETWORK` tertinggal di terminal.

| File | Isi |
|---|---|
| `contracts/LingkarPay.sol` | Contract |
| `test/LingkarPay.test.ts` | 40 test (kelompok, pembayaran, penalti, penutupan periode, pencairan, kuorum) |
| `ignition/modules/LingkarPay.ts` | Modul deploy (Hardhat Ignition) |
| `scripts/new-account.ts` | Membuat akun testnet khusus; private key ke `.secrets/` (tidak dicetak, di-gitignore) |
| `scripts/export-deployment.ts` | Mengekspor alamat dan ABI deploy ke `deployments/` |
| `scripts/inspect-circle.ts` | Membaca state kelompok langsung dari contract (bukan dari database) |
| `hardhat.config.ts`, `package.json`, `tsconfig.json` | Konfigurasi (Hardhat 3.21.2) |

## Deploy ke Sepolia
Hardhat tidak membaca `.env`. `SEPOLIA_RPC_URL` disimpan di keystore Hardhat; private key lewat variabel environment di sesi PowerShell yang sama:
```powershell
npx hardhat run scripts/new-account.ts              # buat akun testnet; catat ALAMATNYA, minta ETH Sepolia lewat faucet
npx hardhat keystore set SEPOLIA_RPC_URL            # tempel URL RPC (Alchemy/Infura) di prompt
$env:SEPOLIA_PRIVATE_KEY = (Get-Content .\.secrets\operator.key).Trim()
npm run deploy:sepolia                              # Ignition, --deployment-id sepolia-v2
npm run export:sepolia                              # tulis deployments/sepolia.json dan ABI
Remove-Item Env:SEPOLIA_PRIVATE_KEY
```
Akun yang sama harus dipakai worker (`OPERATOR_PRIVATE_KEY` di `apps/api/.env`), karena akun deploy menjadi `operator`. Deploy v1 tetap di `ignition/deployments/chain-11155111` sebagai riwayat.

## Verifikasi kode contract
**Sudah terverifikasi** (11 November 2026) di tiga penjelajah blok, sehingga kodenya terbaca publik dan daftar transaksi menampilkan nama fungsi (`Record Payment`, `Vote`, `Mark Payout`, dan seterusnya):
- Etherscan (Exact Match, optimizer 200 runs): https://sepolia.etherscan.io/address/0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2#code
- Blockscout: https://eth-sepolia.blockscout.com/address/0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2#code
- Sourcify: https://sourcify.dev/server/repo-ui/11155111/0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2

Cara mengulang (butuh API key gratis dari etherscan.io yang disimpan di keystore: `npx hardhat keystore set ETHERSCAN_API_KEY`):
```powershell
npx hardhat build --build-profile production        # WAJIB: samakan profil build dengan yang dipakai deploy
$env:SEPOLIA_PRIVATE_KEY = (Get-Content .\.secrets\operator.key).Trim()
npx hardhat verify --network sepolia 0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2
Remove-Item Env:SEPOLIA_PRIVATE_KEY
```
Contract tidak punya argumen constructor. **Pelajaran:** Hardhat Ignition men-deploy dengan profil build `production` (optimizer aktif, 200 runs), sedangkan `npm run build` dan `npm test` memakai profil `default` (tanpa optimizer). Tanpa `build --build-profile production` lebih dulu, `verify` gagal dengan `HHE80009: bytecode does not match any of your local contracts` (bukan masalah API key atau jaringan). `verify` mencoba Etherscan, Blockscout, dan Sourcify sekaligus; yang sudah terverifikasi dijawab `already verified`. Banner Etherscan "may be a proxy contract" adalah heuristik otomatis dan tidak berlaku: contract ini tidak memakai delegatecall, assembly, atau pola upgrade.

## Memeriksa data langsung di contract
`npm run inspect` membaca state satu kelompok langsung dari contract: status, urutan giliran, penerima tiap periode, siapa yang lunas beserta `refHash`, hash pencairan, dan usulan kuorum beserta suaranya. Berguna untuk demo.
```powershell
docker exec lingkarpay-db psql -U lingkarpay -d lingkarpay -c "select id, chain_circle_id from circles order by id desc limit 3;"
$env:SEPOLIA_PRIVATE_KEY = (Get-Content .\.secrets\operator.key).Trim()
$env:HARDHAT_NETWORK = "sepolia"
$env:LINGKARPAY_ADDRESS = "0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2"
$env:CIRCLE_ID = "<chain_circle_id>"
npm run inspect
Remove-Item Env:HARDHAT_NETWORK, Env:SEPOLIA_PRIVATE_KEY, Env:LINGKARPAY_ADDRESS, Env:CIRCLE_ID
```
Variabel `$env:...` hanya berlaku di jendela PowerShell tempat diisi; bersihkan setelah selesai.

## Keputusan desain
| # | Keputusan |
|---|---|
| 1 | `markPayout` menutup periode sendiri bila masih `Running` dan semua iuran lunas; worker cukup memanggil satu fungsi. `closePeriod` tetap ada untuk jalur kuorum |
| 2 | `applyPenalty` mencatat denda yang *terutang* sebagai catatan audit; contract tidak memindahkan uang |
| 3 | Kuorum dikerjakan terakhir: tutup periode dan ganti anggota; suara diteruskan backend |
| 4 | Periode berikutnya dibuka di dalam `markPayout` |
| 5 | Worker idempoten: kelompok memakai `externalRef` dan `circleIdByRef`; usulan memakai `proposalOfPeriod`. Worker yang restart di tengah jalan melanjutkan dari state contract tanpa membuat catatan ganda |

## Status tahapan
| Tahap | Pekerjaan | Status |
|---|---|---|
| T0 | Lingkungan dan kompilasi | Selesai |
| T1 | `closePeriod` dan `markPayout` | Selesai, tes lulus |
| T2 | `applyPenalty` | Selesai, tes lulus |
| T3 | Tes skenario proposal Tabel 19 | Selesai |
| T4 | Deploy ke Sepolia | Selesai: v1 (awal) dan v2 (final, dengan `externalRef` dan kuorum) |
| T5 | Worker terhadap node lokal | Selesai |
| T6 | End to end di Sepolia | Selesai: pembayaran Midtrans sandbox, kuorum, dan pencairan tercatat di Sepolia (`docs/BUKTI_SEPOLIA.md`) |
| T7 | Kuorum | Selesai: contract, tes, dan integrasi backend untuk usulan tutup periode |
| T8 | Dokumentasi | Selesai |

## Batasan yang diketahui
- Operator dipercaya mencatat (oracle problem): contract tidak bisa memverifikasi pembayaran fiat sendiri. Mitigasi: `refHash` memungkinkan audit silang ke catatan gateway, dan semua pencatatan terlihat lewat event.
- Suara kuorum diteruskan operator setelah autentikasi di backend; anggota tidak memegang dompet.
- Anggota yang akan diganti ikut dihitung dalam kuorum dan boleh memberi suara atas penggantinya.
- Riwayat iuran periode yang sudah selesai tetap atas nama anggota lama setelah penggantian.
- Pembayaran yang masuk setelah periode ditutup kuorum tidak bisa dicatat on-chain (contract menolak karena periode sudah tertutup); backend menandainya di rekonsiliasi.
