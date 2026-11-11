# Log Pengembangan Ide dan Keputusan

Catatan diskusi dan keputusan. Tambahkan entri baru di bawah (terbaru di bawah). Format: tanggal, jalur, keputusan atau temuan, alasan.

## 2026-11-05 — Payment gateway
Akun Midtrans sandbox dan Server Key dibuat. Gateway yang dipilih: Midtrans Snap (dokumentasi sandbox lengkap, termasuk dalam pustaka tugas).

## 2026-11-06 — Payment gateway (spike A)
Pop-up Snap muncul, VA BCA dibayar lewat simulator, status sukses. Server Fastify dengan `/checkout`, `/midtrans-webhook`, dan halaman tes. Tunnel Cloudflared dipakai agar Midtrans dapat menjangkau server lokal.

## 2026-11-08 — Payment gateway: keputusan rancangan
- **Arsitektur dana: pilihan A.** Dana ditahan pihak berizin (gateway/escrow); contract hanya aturan dan audit. Alasan: LingkarPay tidak berposisi sebagai penghimpun/penyalur dana (lihat proposal Bab V).
- **Satu mesin status pesanan** (`PENDING → SETTLED → ANCHORED`, dst.) sebagai satu-satunya tempat status berubah. Alasan: notifikasi gateway bisa berulang atau tidak berurutan; status final tidak boleh diturunkan.
- **Outbox (`chain_jobs`) sebagai antarmuka ke modul chain.** Alasan: pembayaran sah tidak boleh batal hanya karena blockchain gagal; pencatatan on-chain diulang terpisah dengan status `SETTLED_PENDING_CHAIN`.
- **Uang BIGINT rupiah**, tidak pernah float. **`member_ref` samaran** untuk on-chain, tanpa data pribadi (UU PDP).
- **Biaya admin tidak ikut dicairkan**; dana pencairan = iuran + penalti.
- **Penalti di-snapshot saat order dibuat.** Batasan yang diketahui: order PENDING yang dipakai ulang tidak menghitung ulang penalti.
- **Postgres + SQL migrasi biasa (tanpa ORM)** agar mudah dijelaskan saat presentasi.

## 2026-11-08 — Payment gateway: temuan saat uji nyata
- Midtrans mengirim notifikasi ke alamat tunnel tanpa path (`POST /`); server menerima di `/` dan `/midtrans-webhook`.
- Signature notifikasi dan Status API tidak cocok bila dihitung dari Server Key. Dashboard kelompok memisahkan **Signature Secret Key**; memakainya (`MIDTRANS_SIGNATURE_KEY`) membuat signature valid. Server Key tetap dipakai untuk autentikasi API.
- Node sempat timeout (`UND_ERR_CONNECT_TIMEOUT`) ke `api.sandbox.midtrans.com` padahal PowerShell bisa terhubung. Panggilan keluar dipaksa IPv4 dengan retry.
- Saat merancang tes ditemukan race condition di checkout: permintaan kedua bisa menutup order yang belum sempat mendapat token. Diperbaiki dengan menunggu token.
- Smoke test alur penuh (dua anggota, pencairan simulasi) lolos 30 pemeriksaan.

## 2026-11-08 — Payment gateway x Smart contract: antarmuka kelompok on-chain
Keputusan: kelompok yang dimulai menghasilkan job outbox `createCircle`; modul chain mengonfirmasinya dengan `markCircleCreated` (menyimpan id on-chain). Job pembayaran dan pencairan kelompok itu ditahan `claimJobs` sampai kelompok on-chain. Alasan: worker chain tidak perlu menulis query sinkronisasi sendiri, dan pembayaran yang masuk lebih dulu tidak menghabiskan percobaan ulang. Dampak: jalur smart contract cukup memakai fungsi `claimJobs`, `markCircleCreated`, `markJobConfirmed`, `markJobFailed`.

## 2026-11-08 — Payment gateway: uji e-wallet di sandbox
Pembayaran e-wallet (GoPay lewat simulator Midtrans, kode QR) berhasil: order SETTLED, rekonsiliasi `issues=0`. Temuan: Midtrans melaporkannya dengan `payment_type` = `qris`, bukan `gopay`. Pemeriksaan jenis pembayaran di skrip uji disesuaikan. Dibayar hanya lewat simulator, tidak memakai aplikasi sungguhan. Catatan: kanal yang diaktifkan di kode adalah `gopay` dan `shopeepay` (bukan kanal QRIS umum), tetapi pada GoPay QR Midtrans memakai istilah qris; di business case dan presentasi sebutkan sebagai "e-wallet (GoPay)".

## 2026-11-08 — Payment gateway: cancel dan expire lewat API
Ditambahkan `POST /orders/:orderId/cancel` dan `/expire` (memanggil Cancel/Expire API Midtrans lalu menyinkronkan status; order menjadi FAILED atau EXPIRED sehingga anggota bisa membayar lagi). Awalnya Midtrans menjawab `403 {"error":"Access denied"}` untuk keduanya, padahal Status API dan Snap dengan key yang sama berhasil. **Penyebab:** server key dibuat tanpa izin Capability "Cancel transaction" dan "Expire transaction" (bawaan form pembuatan key adalah None). Setelah key baru dibuat dengan kedua izin itu diset Write dan `.env` diperbarui (server direstart), kedua skenario lolos di sandbox: expire menghasilkan EXPIRED dan cancel menghasilkan FAILED.

Temuan teknis: Expire API menandai sukses dengan `status_code` 407 ("Success, transaction is expired"), sedangkan Cancel API memakai 200. Dugaan awal (pembatasan IP/jaringan, header) keliru. Pelajaran: key Midtrans baru memisahkan izin per produk dan per kemampuan; refund tidak diaktifkan (hak akses seminimal mungkin).

## 2026-11-08 — Kerangka awal untuk jalur lain
Jalur payment gateway menyiapkan kerangka kode agar jalur lain punya bayangan dan titik mulai: `contracts/` (contract inti + tes + deploy), `apps/api/src/chain/worker.example.ts` (worker viem), dan `apps/web/` (Vite + React: login, dashboard, detail kelompok, tombol bayar Snap, portal verifikasi). Sengaja berhenti di bagian dasar: fungsi rumit (penalti, penutupan periode, pencairan, kuorum), idempotensi worker, dan halaman lanjutan ditandai `TODO(smart-contract)` / `TODO(frontend)` sebagai pekerjaan jalur masing-masing. Semuanya belum dikompilasi atau dijalankan.

## 2026-11-09 — Keputusan desain contract disepakati; kontribusi smart contract
Lima keputusan desain contract disepakati (lihat `contracts/README.md`): `markPayout` menutup periode sendiri; `applyPenalty` mencatat denda terutang sebagai audit; kuorum terakhir dan opsional; periode berikutnya dibuka di `markPayout`; worker idempoten. Jalur smart contract belum dimulai oleh anggota lain, sehingga pengerjaan dimulai dari tahap T0 (lingkungan dan kompilasi kerangka) oleh jalur payment gateway, dengan pemilik jalur tetap dilibatkan agar kontribusi dan pemahaman tetap terbagi.

## 2026-11-11 — T5 end to end di node lokal lolos
Worker chain dijalankan terhadap node Hardhat lokal bersama backend dan Midtrans sandbox: pembayaran di simulator (dua anggota) menghasilkan order `ANCHORED`; job `createCircle`, `recordPayment`, dan `markPayout` terkonfirmasi (dicek lewat database). Worker mendahulukan `createCircle`, dan job pembayaran milik kelompok yang dibuat sebelum migrasi 002 (belum punya `chain_circle_id`) tetap `queued`, sesuai desain gating di `claimJobs`. Tahap berikutnya: T4 dan T6 di Sepolia.

## 2026-11-11 — Contract ter-deploy ke Sepolia (T4, deploy awal v1)
(Deploy awal; digantikan deploy final v2 pada hari yang sama, lihat entri "Idempotensi, kuorum ke backend, dan deploy final".) LingkarPay ter-deploy ke Sepolia (`0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0`) lewat Hardhat Ignition dengan akun testnet khusus (private key hanya di `.secrets/`, di-gitignore; URL RPC di keystore Hardhat). Alamat dan ABI diekspor ke `contracts/deployments/`. Berikutnya T6: worker dan backend diarahkan ke Sepolia (`CHAIN_NAME=sepolia`), lalu smoke test dan bukti transaksi di Etherscan.

## 2026-11-11 — Idempotensi, kuorum ke backend, dan deploy final
- **Idempotensi.** `createCircle` di contract menerima `externalRef` (hash id kelompok di database) dan menolak referensi ganda; `proposeClosePeriod` menolak usulan kedua selama yang pertama berlaku. Worker kini melanjutkan dari state contract bila mati di tengah jalan (tidak ada kelompok, iuran, suara, atau pencairan ganda). Dua TODO worker lama selesai.
- **Kuorum di backend** (usulan tutup periode): migrasi 003 (`proposals`, `proposal_votes`, kolom `chain_jobs.proposal_id` dan `vote_id`), endpoint, tiga jenis job baru, dan handler worker. 8 tes integrasi, `smoke-quorum.ps1`.
- **Temuan dari uji nyata.** (1) Worker lama yang belum di-restart mengambil job jenis baru dan "menyelesaikannya" diam-diam (tanpa case yang cocok), sehingga job berstatus `sent` terus tanpa error; sekarang jenis job tidak dikenal gagal dengan error jelas. (2) `markPayout` bisa kehabisan percobaan (backoff sekitar 2,5 menit) sebelum rantai usulan, suara, dan eksekusi selesai, karena contract menolak pencairan periode yang belum ditutup kuorum; sekarang `markPayout` ditahan sampai semua job kuorum kelompok itu terkonfirmasi (ada tesnya). (3) Worker baru ke contract lama gagal (`execution reverted`) karena tanda tangan fungsi berbeda; contract dan worker harus cocok versinya.
- **Deploy final ke Sepolia (v2)**: `0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2` (deploy v1 `0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0` diarsipkan). Database dev dikosongkan karena id kelompok on-chain berubah. Terbukti end to end: satu anggota membayar (Midtrans sandbox), usulan tutup periode disetujui 2 dari 3, periode dicairkan, dan semua job `confirmed` di Sepolia (`docs/BUKTI_SEPOLIA.md`).
- **Verifikasi kode contract** di Etherscan, Blockscout, dan Sourcify berhasil (Exact Match). Hambatan: `hardhat verify` awalnya gagal (`bytecode does not match`) karena Ignition men-deploy dengan profil build `production` (optimizer aktif) sedangkan build lokal memakai `default`; diselesaikan dengan `hardhat build --build-profile production` sebelum `verify`.
- **Keamanan.** Server Key dan Signature Secret Key Midtrans sempat tertempel di percakapan dengan AI; keduanya sudah di-rotate. Aturan baru di `RULES.md`: jangan menempelkan isi `.env`.

## Template entri
```
## YYYY-MM-DD — <jalur>
Keputusan/temuan, alasan, siapa yang memutuskan, dan dampak ke jalur lain.
```
