# src/chain — modul chain (jalur smart contract)

Worker TypeScript yang membaca outbox backend dan mencatatnya ke contract LingkarPay (Sepolia atau node lokal Hardhat). Berjalan dalam proyek `apps/api` agar memakai langsung fungsi dan koneksi database yang sudah ada.

**Status:** terbukti end to end di Sepolia dan node lokal (`docs/BUKTI_SEPOLIA.md`).

## Menjalankan
Konfigurasi di `apps/api/.env` (divalidasi di `src/config.schema.ts`; satu set aktif saja, jangan ada baris ganda):
```dotenv
CHAIN_NAME=sepolia                 # sepolia atau hardhat (node lokal)
CHAIN_RPC_URL=<URL RPC>            # Alchemy/Infura Sepolia, atau http://127.0.0.1:8545 untuk node lokal
OPERATOR_PRIVATE_KEY=<private key> # akun yang men-deploy contract (menjadi operator); testnet khusus!
LINGKARPAY_ADDRESS=<alamat contract>
```
```powershell
cd C:\coding\lingkarpay\apps\api
npm run chain:worker
```
Baris pertama log harus menampilkan jaringan, alamat operator, dan alamat contract yang benar. **Worker tidak memuat ulang otomatis**: restart setelah `.env` atau kode berubah (backend `npm run dev` memuat ulang sendiri). Jangan menjalankan dua worker bersamaan.

## Antarmuka dengan outbox (`../services/outbox.ts`)
| Fungsi | Dipakai worker untuk |
|---|---|
| `claimJobs(limit)` | Mengambil job yang siap, lalu menandainya `sent`. Aman dijalankan paralel. `createCircle` didahulukan; job lain hanya diberikan bila kelompoknya sudah on-chain; `castVote`/`executeProposal` menunggu usulannya on-chain; `markPayout` menunggu semua job kuorum kelompoknya terkonfirmasi. Job `sent` yang macet > 5 menit diambil ulang |
| `markCircleCreated(jobId, chainCircleId, txHash)` | Kelompok sudah on-chain; menyimpan `circles.chain_circle_id`. Idempoten |
| `markProposalCreated(jobId, chainProposalId, txHash)` | Usulan sudah on-chain; menyimpan `proposals.chain_proposal_id`. Idempoten |
| `markJobConfirmed(jobId, txHash)` | Transaksi terkonfirmasi (`recordPayment`, `markPayout`, `castVote`, `executeProposal`). Order `recordPayment` menjadi `ANCHORED` |
| `markJobFailed(jobId, error)` | Gagal kirim. Backoff otomatis sampai 5 percobaan; order menjadi `SETTLED_PENDING_CHAIN` |
| `requeueJob(jobId)` | Operator mengantrekan ulang job yang sudah `failed` |

## Jenis job
| Job | Transaksi di contract |
|---|---|
| `createCircle` | `createCircle(externalRef, ...)`, `addMember` per anggota sesuai urutan giliran, `startCircle` |
| `recordPayment` | `recordPayment` |
| `markPayout` | `markPayout` (menutup periode sendiri bila semua lunas atau sudah disetujui kuorum) |
| `proposeClosePeriod` | `proposeClosePeriod` |
| `castVote` | `vote` |
| `executeProposal` | `executeProposal` |

## Idempoten (aman bila worker mati di tengah jalan)
Percobaan ulang melanjutkan dari state contract dan tidak membuat catatan ganda:
- **`createCircle`:** memakai `externalRef` = `keccak256("lingkarpay:circle:<id database>")`. Bila `circleIdByRef` sudah berisi id, kelompok dipakai ulang; anggota yang sudah masuk (`getMembers`) tidak ditambah lagi; `startCircle` hanya bila status masih Draft.
- **`recordPayment`, `markPayout`, `castVote`, `executeProposal`:** bila hasilnya sudah ada di contract (`getPayment`, `getPeriod`, `hasVoted`, `getProposal`) dan hash-nya sama, job dianggap sukses; bila berbeda, job gagal dengan pesan jelas.
- **`proposeClosePeriod`:** memakai `proposalOfPeriod`; usulan yang masih berlaku dipakai ulang.
- Hash transaksi untuk kasus "sudah tercatat" dicari dari event terbaru (rentang dipecah 10 blok, sekitar 300 blok ke belakang agar tidak ditolak penyedia RPC gratis). Bila tidak ditemukan (pemulihan setelah jeda panjang), job gagal dengan pesan agar memeriksa Etherscan.
- Jenis job yang tidak dikenal (worker lama belum di-restart) **gagal dengan error**, tidak "selesai" diam-diam.

## Pelajaran dari uji nyata
- Worker harus di-restart setelah kode berubah; job baru yang diambil worker lama akan gagal dengan pesan jelas.
- Contract dan worker harus versi yang cocok: worker baru ke contract lama gagal (`execution reverted`) karena tanda tangan fungsi berbeda.
- `markPayout` ditahan sampai job kuorum kelompok itu terkonfirmasi; tanpa itu pencairan bisa kehabisan percobaan (backoff sekitar 2,5 menit) sebelum rantai usulan selesai.

## Uji terhadap node lokal (cepat, tanpa ETH)
```powershell
# terminal 1 (folder contracts): node lokal; catat "Account #0" dan private key-nya
npm run node
# terminal 2 (folder contracts): deploy ke node lokal; catat alamat
npm run deploy:local
```
Isi `.env` dengan `CHAIN_NAME=hardhat`, `CHAIN_RPC_URL=http://127.0.0.1:8545`, `OPERATOR_PRIVATE_KEY` = key Account #0 dari node (kunci publik bawaan Hardhat, hanya untuk node lokal), `LINGKARPAY_ADDRESS` = alamat deploy. Restart backend, jalankan worker, lalu `scripts\smoke.ps1 -Both` atau `scripts\smoke-quorum.ps1 -WaitChain`. State node lokal hilang saat node dimatikan.

## Batasan
- Belum ada shutdown rapi (SIGINT), metrik, dan beberapa worker serentak (transaksi dikirim berurutan dari satu akun).
- Belum ada tes otomatis untuk worker; verifikasinya lewat uji end to end (`docs/BUKTI_SEPOLIA.md`).
