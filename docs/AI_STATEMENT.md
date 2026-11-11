# Pernyataan Penggunaan Alat AI

> Draf dari jalur payment gateway. Anggota jalur lain melengkapi bagian jalurnya, lalu seluruh kelompok menyetujui sebelum dikumpulkan.

## Alat
Claude (Anthropic) dipakai sebagai pendamping.

## Dipakai untuk apa
- Menyusun kerangka dan draf proposal, merancang diagram, menelusuri rujukan (lihat proposal Bab VII.G).
- **Jalur payment gateway:** merancang arsitektur backend, menulis draf kode (`apps/api`), tes otomatis, skrip uji PowerShell, dan dokumentasi (`docs/`).
- **Smart contract dan modul chain** (`contracts/`, `apps/api/src/chain/`): contract, tes, skrip deploy, worker, dan integrasi kuorum ke backend dikerjakan bersama AI, lalu dikompilasi, dites, di-deploy ke Sepolia, dan diverifikasi oleh pengembang.
- **Kerangka frontend** (`apps/web/`): contoh awal agar anggota jalur frontend punya titik mulai. Belum dikompilasi atau dijalankan, dan akan dikerjakan serta diverifikasi oleh anggota jalur tersebut.
- Jalur lain: *(diisi anggota yang bersangkutan)*.

## Bagaimana hasilnya diverifikasi
- Kode dijalankan dan diuji oleh pengembang di komputernya (AI tidak dapat menjalankan kode di lingkungan itu): `npm run typecheck`, migrasi database, `npm test` (101 tes backend, 40 tes contract), smoke test alur penuh (`apps/api/scripts/smoke.ps1`, termasuk dua anggota dan pencairan simulasi), smoke test kuorum (`smoke-quorum.ps1`), skenario di Midtrans sandbox (sukses VA, sukses e-wallet, kedaluwarsa, dibatalkan), dan uji end to end di Ethereum Sepolia dengan hash transaksi yang dicocokkan ke Etherscan (`docs/BUKTI_SEPOLIA.md`).
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
- Perkiraan jumlah test contract (38) meleset; hasil sebenarnya 37 (kemudian 40). Dikoreksi dari keluaran test pengembang.
- Rancangan awal outbox untuk kuorum membuat `markPayout` bisa kehabisan percobaan sebelum rantai usulan, suara, dan eksekusi selesai (ditemukan lewat uji di Sepolia). Diperbaiki dengan menahan `markPayout` sampai job kuorum kelompok itu terkonfirmasi, dan diberi tes.
- Worker awal "menyelesaikan" job jenis yang tidak dikenal tanpa error (tidak ada `default` pada `switch`), sehingga job terjebak berstatus `sent`. Diperbaiki: jenis job tidak dikenal gagal dengan pesan jelas.
- Skrip `smoke-quorum.ps1` awal membaca `issues` dari tempat yang salah (seharusnya `summary.issues`); ditemukan saat meninjau skrip lama sebelum dijalankan.
- Instruksi uji awal mengarahkan ke node lokal padahal `.env` pengembang menunjuk ke Sepolia dengan contract lama; ketidakcocokan versi contract dan worker ditemukan dari log dan diselesaikan dengan deploy final ke Sepolia.

## Batasan yang diketahui
- Klien Midtrans Iris (payout) ditulis dari dokumentasi dan belum diuji di sandbox.
- Ganti anggota lewat kuorum hanya ada di contract dan tesnya, belum di backend.
- Belum ada tes otomatis untuk worker chain; verifikasinya lewat uji end to end di Sepolia.
- Jalur frontend dan business case dikerjakan anggota lain; kerangka frontend belum dikompilasi atau dijalankan.
- Rekonsiliasi mode `live=true` belum dicoba.
