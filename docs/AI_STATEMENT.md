# Pernyataan Penggunaan Alat AI

> Draf dari jalur payment gateway. Anggota jalur lain melengkapi bagian jalurnya, lalu seluruh kelompok menyetujui sebelum dikumpulkan.

## Alat
Claude (Anthropic) dipakai sebagai pendamping.

## Dipakai untuk apa
- Menyusun kerangka dan draf proposal, merancang diagram, menelusuri rujukan (lihat proposal Bab VII.G).
- **Jalur payment gateway:** merancang arsitektur backend, menulis draf kode (`apps/api`), tes otomatis, skrip uji PowerShell, dan dokumentasi (`docs/`).
- **Kerangka untuk jalur lain** (`contracts/`, `apps/api/src/chain/worker.example.ts`, `apps/web/`): contoh awal agar anggota punya titik mulai. Belum dikompilasi atau dijalankan, dan akan dikerjakan serta diverifikasi oleh anggota jalur masing-masing.
- Jalur lain: *(diisi anggota yang bersangkutan)*.

## Bagaimana hasilnya diverifikasi
- Kode dijalankan dan diuji oleh pengembang di komputernya (AI tidak dapat menjalankan kode di lingkungan itu): `npm run typecheck`, migrasi database, `npm test` (87 tes), smoke test alur penuh (`apps/api/scripts/smoke.ps1`, termasuk dua anggota dan pencairan simulasi), dan skenario di Midtrans sandbox (sukses VA, sukses e-wallet, kedaluwarsa, dibatalkan).
- Rumus signature dicocokkan dengan respons Status API Midtrans yang asli (`signatureValid: true`).
- Pemindaian rahasia pada setiap commit; Server Key dan kunci lain tidak pernah dibagikan ke AI maupun di-commit.
- Klaim faktual dicocokkan dengan dokumentasi resmi atau dinyatakan sebagai asumsi.

## Kesalahan AI yang ditemukan dan diperbaiki
- Draf awal Bab V proposal salah menyebut gateway yang mengelola dana (perbaikan: tiga opsi arsitektur dan regulasi rupiah).
- Nama parameter Snap `enable_payments` salah; yang benar `enabled_payments` (ditemukan saat tinjauan kode).
- Asumsi bahwa signature dihitung dari Server Key tidak sesuai dashboard kelompok; ditemukan lewat uji nyata dan diperbaiki dengan Signature Secret Key.
- Race condition di checkout (order yang sedang dibuat bisa ditutup permintaan lain) ditemukan saat merancang tes dan diperbaiki.
- Nilai bawaan boolean di konfigurasi salah pada zod 4 (`IRIS_ENABLED` bawaan menjadi string yang bernilai benar). Terdeteksi oleh `typecheck` pengembang; diperbaiki dan diberi tes.
- Body JSON kosong pada `POST` aksi ditolak server; ditemukan lewat uji skrip dan diperbaiki.
- Asumsi `status_code` sukses Expire API adalah 200 keliru; yang benar 407. Ditemukan lewat uji sandbox.
- Dugaan awal penyebab `403 Access denied` pada cancel/expire (pembatasan IP/jaringan, header) keliru. Penyebab sebenarnya izin Capability pada server key; ditemukan pengembang dari form pembuatan key.
- Pemeriksaan jenis pembayaran e-wallet di skrip uji terlalu sempit: Midtrans melaporkan GoPay lewat QR sebagai `qris`.

## Batasan yang diketahui
- Klien Midtrans Iris (payout) ditulis dari dokumentasi dan belum diuji di sandbox.
- Pencatatan on-chain (modul chain dan contract) dikerjakan jalur smart contract; kerangka awal belum diverifikasi.
- Rekonsiliasi mode `live=true` belum dicoba.
