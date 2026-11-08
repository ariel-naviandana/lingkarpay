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

## Kerangka awal (sudah disiapkan)
`worker.example.ts` berisi kerangka worker dengan `viem`: loop `claimJobs`, penanganan job `createCircle`/`recordPayment`/`markPayout`, pelaporan hasil ke outbox. **Belum dikompilasi dan belum diuji.** File itu dikecualikan dari `tsconfig` (`*.example.ts`) agar `npm run typecheck` tetap hijau sebelum `viem` dipasang.

Mengaktifkan: `npm i viem`, ganti nama menjadi `worker.ts`, tambah skrip `"chain:worker": "tsx src/chain/worker.ts"`, isi `.env` (`SEPOLIA_RPC_URL`, `OPERATOR_PRIVATE_KEY`, `LINGKARPAY_ADDRESS`).

### Yang menjadi pekerjaan jalur ini (TODO)
Cari `TODO(smart-contract)` di file itu:
1. Idempotensi `createCircle` (worker mati di tengah jalan jangan membuat kelompok ganda).
2. Perlakuan `AlreadyRecorded` sebagai sukses pada `recordPayment`.
3. Urutan `closePeriod` dan `markPayout` (bergantung keputusan desain contract).
4. Pindahkan variabel `.env` ke `config.schema.ts` (zod), shutdown rapi, tes (boleh dengan contract lokal Hardhat).
5. Tes integrasi: jalankan worker terhadap contract lokal, lalu periksa order menjadi `ANCHORED` dan `circles.chain_circle_id` terisi.
