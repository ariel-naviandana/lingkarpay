# Pernyataan Penggunaan Alat AI

> Draf dari jalur payment gateway. Anggota jalur lain melengkapi bagian jalurnya, lalu seluruh kelompok menyetujui sebelum dikumpulkan.

## Alat
Claude (Anthropic) dipakai sebagai pendamping.

## Dipakai untuk apa
- Menyusun kerangka dan draf proposal, merancang diagram, menelusuri rujukan (lihat proposal Bab VII.G).
- **Jalur payment gateway:** merancang arsitektur backend, menulis draf kode (`apps/api`), tes, skrip uji, dan dokumentasi (`docs/`).
- Jalur lain: *(diisi anggota yang bersangkutan)*.

## Bagaimana hasilnya diverifikasi
- Kode dijalankan dan diuji oleh pengembang di komputernya: `npm run typecheck`, migrasi database, uji spike dengan Midtrans sandbox, dan smoke test alur penuh (`apps/api/scripts/smoke.ps1`).
- Rumus signature webhook dicocokkan dengan respons Status API Midtrans yang asli (`signatureValid: true`).
- Tes otomatis (`npm test`) untuk logika murni dan skenario webhook, checkout, outbox, pencairan, dan rekonsiliasi.
- Pemindaian rahasia pada setiap commit; Server Key dan kunci lain tidak pernah dibagikan ke AI maupun di-commit.
- Klaim faktual dicocokkan dengan dokumentasi resmi atau dinyatakan sebagai asumsi.

## Kesalahan AI yang ditemukan dan diperbaiki
- Draf awal Bab V proposal salah menyebut gateway yang mengelola dana (perbaikan: tiga opsi arsitektur dan regulasi rupiah).
- Nama parameter Snap `enable_payments` salah; yang benar `enabled_payments` (ditemukan saat tinjauan kode).
- Asumsi bahwa signature dihitung dari Server Key tidak sesuai dashboard kelompok; ditemukan lewat uji nyata dan diperbaiki dengan Signature Secret Key.
- Race condition di checkout ditemukan saat merancang tes dan diperbaiki.

## Batasan yang diketahui
- Klien Midtrans Iris (payout) ditulis dari dokumentasi dan belum diuji di sandbox.
- Pencatatan on-chain (modul chain dan contract) dikerjakan jalur smart contract.
- AI tidak dapat menjalankan kode di lingkungan pengembangan pengguna; seluruh verifikasi dijalankan manual oleh pengembang.
