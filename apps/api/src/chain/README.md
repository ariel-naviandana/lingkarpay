# src/chain — modul chain (jalur smart contract)

Belum dimulai. Folder ini milik jalur smart contract. Modul ini adalah worker TypeScript yang membaca outbox backend dan mencatatnya ke contract di Sepolia. Berjalan dalam proyek `apps/api` agar bisa memakai langsung fungsi dan koneksi database yang sudah ada.

## Antarmuka (sudah ada, jangan diubah tanpa sepakat)
Fungsi di `../services/outbox.ts`:

| Fungsi | Dipakai worker untuk |
|---|---|
| `claimJobs(limit)` | Mengambil job `queued` yang siap. Aman dijalankan paralel. Job `sent` yang macet > 5 menit diambil ulang. |
| `markJobConfirmed(jobId, txHash)` | Tx terkonfirmasi. Order `recordPayment` menjadi `ANCHORED`. Idempoten. |
| `markJobFailed(jobId, error)` | Pengiriman gagal. Backoff otomatis sampai 5 percobaan; order menjadi `SETTLED_PENDING_CHAIN`. Mengembalikan `{ willRetry }`. |
| `requeueJob(jobId)` | Operator mengantrekan ulang job yang sudah `failed`. |

Payload dan bentuk job: `docs/DESIGN.md` bagian 7, `contracts/README.md`.

## Alur worker (disarankan)
```
loop:
  1. sinkronkan kelompok ke chain (lihat bawah)
  2. jobs = claimJobs(10)
  3. untuk tiap job:
       recordPayment → contract.recordPayment(circleChainId, periodNo, memberRef, refHash, paidAt)
       markPayout    → contract.markPayout(circleChainId, periodNo, payoutRefHash)
       tunggu receipt → markJobConfirmed(job.id, txHash)
       error          → markJobFailed(job.id, pesan)    // jangan menyertakan key atau URL RPC berkunci
  4. tidur beberapa detik
```
Kirim transaksi berurutan dari satu akun operator (kelola nonce), dan jangan membuat tx ganda untuk job yang sama (cek receipt/`refHash` bila worker restart).

## Menyinkronkan kelompok ke chain
Backend belum membuat job `createCircle`/`startCircle`. Worker harus mencarinya sendiri sebelum memproses pembayaran:
```sql
SELECT id, contribution_amount, member_count, period_days, penalty_pct
  FROM circles WHERE status IN ('active','completed') AND chain_circle_id IS NULL;
-- anggota dan urutan giliran:
SELECT member_ref, turn_order FROM members WHERE circle_id = $1 ORDER BY turn_order;
```
Lalu `createCircle` → `addMember` (tiap anggota, urutan giliran) → `startCircle`, kemudian simpan id on-chain:
```sql
UPDATE circles SET chain_circle_id = $2 WHERE id = $1;
```
Di `recordPayment`, ambil `circles.chain_circle_id` lewat `payload.circleId` saat dieksekusi (nilai `payload.circleChainId` di job bisa masih `null` karena diambil saat order dibayar). Kelompok harus sudah on-chain sebelum job pembayarannya diproses; jalankan langkah sinkronisasi lebih dulu di tiap putaran.

## Rahasia
Kunci penanda tangan operator dan RPC URL dibaca dari `.env` (jangan masuk kode, log, atau commit). Tambahkan variabel barunya ke `../../.env.example` dengan nilai contoh palsu dan ke `config.ts` (divalidasi zod).

## Ditambahkan oleh jalur ini
Skrip npm `chain:worker` di `apps/api/package.json`, dependensi `viem`, tes (boleh dengan contract lokal Hardhat), dan dokumentasi.
