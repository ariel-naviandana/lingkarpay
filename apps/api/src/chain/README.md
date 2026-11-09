# src/chain — modul chain (jalur smart contract)

Folder ini milik jalur smart contract. Kerangka awal sudah disiapkan (lihat bagian "Kerangka awal" di bawah). Modul ini adalah worker TypeScript yang membaca outbox backend dan mencatatnya ke contract di Sepolia. Berjalan dalam proyek `apps/api` agar bisa memakai langsung fungsi dan koneksi database yang sudah ada.

## Antarmuka (sudah ada, jangan diubah tanpa sepakat)
Fungsi di `../services/outbox.ts`:

| Fungsi | Dipakai worker untuk |
|---|---|
| `claimJobs(limit)` | Mengambil job yang siap, lalu menandainya `sent`. Aman dijalankan paralel. `createCircle` didahulukan; job pembayaran/pencairan hanya diberikan bila kelompoknya sudah on-chain, dan `payload.circleChainId` sudah terisi. Job `sent` yang macet > 5 menit diambil ulang. |
| `markCircleCreated(jobId, chainCircleId, txHash)` | Kelompok sudah dibuat di chain. Menyimpan id on-chain ke `circles.chain_circle_id`. Idempoten. |
| `markJobConfirmed(jobId, txHash)` | Tx `recordPayment`/`markPayout` terkonfirmasi. Order `recordPayment` menjadi `ANCHORED`. Idempoten. |
| `markJobFailed(jobId, error)` | Pengiriman gagal. Backoff otomatis sampai 5 percobaan; order menjadi `SETTLED_PENDING_CHAIN`. Mengembalikan `{ willRetry }`. |
| `requeueJob(jobId)` | Operator mengantrekan ulang job yang sudah `failed`. |

Payload dan bentuk job: `docs/DESIGN.md` bagian 7 dan `contracts/README.md`.

## Alur worker (disarankan)
```
loop:
  jobs = claimJobs(10)
  untuk tiap job:
    createCircle  → contract.createCircle(parameter) → addMember(memberRef, turnOrder) tiap anggota
                    → startCircle → baca id kelompok on-chain dari event/return
                    → markCircleCreated(job.id, chainCircleId, txHash)
    recordPayment → contract.recordPayment(circleChainId, periodNo, memberRef, refHash, paidAt)
                    → tunggu receipt → markJobConfirmed(job.id, txHash)
    markPayout    → contract.markPayout(circleChainId, periodNo, payoutRefHash)
                    → tunggu receipt → markJobConfirmed(job.id, txHash)
    error         → markJobFailed(job.id, pesan)   // jangan menyertakan key atau URL RPC berkunci
  tidur beberapa detik
```
Kirim transaksi berurutan dari satu akun operator (kelola nonce), dan jangan membuat tx ganda untuk job yang sama (cek receipt atau `refHash` bila worker restart).

Tidak perlu query sinkronisasi kelompok sendiri: kelompok yang dimulai otomatis menghasilkan job `createCircle`, dan pembayaran yang masuk sebelum kelompok on-chain menunggu di antrean tanpa menghabiskan percobaan.

## Rahasia
Kunci penanda tangan operator dan RPC URL dibaca dari `.env` (jangan masuk kode, log, atau commit). Tambahkan variabel barunya ke `../../.env.example` dengan nilai contoh palsu dan ke `config.ts` (divalidasi zod).

## Ditambahkan oleh jalur ini
Skrip npm `chain:worker` di `apps/api/package.json`, dependensi `viem`, tes (boleh dengan contract lokal Hardhat), dan dokumentasi.

## Mencoba tanpa contract
Untuk memeriksa alur dari sisi backend, simulasikan worker lewat REPL atau skrip kecil yang memanggil `claimJobs` lalu `markCircleCreated`/`markJobConfirmed` dengan hash palsu; status order dan rekonsiliasi akan ikut berubah.

## Worker (sudah disiapkan, menunggu uji ujung ke ujung)
`worker.ts` memakai `viem`: loop `claimJobs`, penanganan job `createCircle`/`recordPayment`/`markPayout`, pelaporan hasil ke outbox. Konfigurasi di `.env` (divalidasi di `src/config.schema.ts`): `CHAIN_NAME` (`hardhat` untuk node lokal, `sepolia`), `CHAIN_RPC_URL`, `OPERATOR_PRIVATE_KEY`, `LINGKARPAY_ADDRESS`. **Belum pernah dijalankan.**

### Uji terhadap node lokal (T5)
Butuh empat terminal (Windows). Dari `C:\coding\lingkarpay`:
```powershell
# 1) Postgres dan backend (seperti biasa)
docker compose up -d
cd apps\api; npm install; npm run migrate; npm run dev

# 2) Node blockchain lokal (terminal lain). Catat "Account #0" dan private key-nya dari layar node.
cd contracts; npm run node

# 3) Deploy contract ke node lokal (terminal lain); catat alamat yang dicetak
cd contracts; npm run deploy:local
```
Isi `apps\api\.env` (kunci akun lokal ini hanya untuk node lokal, bukan untuk uang asli): `CHAIN_NAME=hardhat`, `CHAIN_RPC_URL=http://127.0.0.1:8545`, `OPERATOR_PRIVATE_KEY` = private key Account #0 yang ditampilkan node, `LINGKARPAY_ADDRESS` = alamat hasil deploy. Restart backend, lalu:
```powershell
# 4) Worker (terminal lain)
cd apps\api; npm run chain:worker

# 5) Buat data dan bayar
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both
```
Yang harus terlihat: log worker `job N (createCircle) selesai`, `circles.chain_circle_id` terisi, lalu `job N (recordPayment) selesai` dan order menjadi `ANCHORED` (`GET /orders/<id>` menampilkan `chainStatus: confirmed`), dan setelah pencairan job `markPayout` selesai.

### TODO yang masih tersisa
1. Idempotensi `createCircle` (worker mati di tengah jalan jangan membuat kelompok ganda).
2. `AlreadyRecorded` pada `recordPayment` dianggap sukses (tx sebelumnya sebenarnya berhasil).
3. Shutdown rapi (SIGINT), metrik, dan banyak worker.
4. Tes integrasi worker terhadap contract lokal.
