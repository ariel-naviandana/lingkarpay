# Rencana Pengerjaan — Jalur Payment Gateway

Target: prototipe dibekukan 25 Nov, business case 24 Nov, presentasi mulai 26 Nov. Progress report dijadwalkan di kelas sebelum 24 Nov, jadi alur webhook dan checkout harus bisa didemokan paling lambat pertengahan November.

Aturan commit: tiap langkah = commit + push (lihat `RULES.md`). Kolom "Selesai bila" adalah kriteria penerimaan.

| # | Langkah | Selesai bila | Commit |
|---|---|---|---|
| 0 | Cek baseline repo | Remote/branch jelas, `.env` tidak terlacak, `.gitignore` di root ada | `chore: baseline repo` |
| 1 | Dokumen aturan, rancangan, rencana | `docs/RULES.md`, `DESIGN.md`, `PLAN.md` ada di repo | `docs: aturan, rancangan v1, rencana` |
| 2 | Spike B: webhook masuk | Notifikasi transaksi uji tiba di server dengan signature valid. Tambah `ipv4first`, endpoint `/status/:orderId` yang memverifikasi signature | `fix(api): ipv4first` dan `feat(api): status endpoint` |
| 3 | Struktur proyek | `src/config.ts` (validasi env), pemisahan `routes/services/db/lib`, skrip `typecheck` dan `test` | `refactor(api): struktur modul` |
| 4 | Database | `docker-compose.yml` Postgres, migrasi skema sesuai DESIGN §3, skrip migrate | `feat(api): skema database` |
| 5 | Mesin status pesanan | Satu modul transisi + tes semua transisi sah/tidak sah | `feat(api): mesin status pesanan` |
| 6 | API kelompok, anggota, periode | Endpoint DESIGN §4 (bagian circles), data lewat DB, tes | `feat(api): API circles` |
| 7 | Tagihan | `computeBill` (iuran + penalti + admin) dengan tes angka | `feat(api): perhitungan tagihan` |
| 8 | Checkout | Order PENDING idempoten + token Snap; panggilan ulang tidak membuat order ganda | `feat(api): checkout idempoten` |
| 9 | Webhook | Signature (timing-safe), dedupe, cek jumlah, update status via mesin status, balas 200; fallback Status API untuk notifikasi tidak berurutan | `feat(api): webhook aman` |
| 10 | Outbox ke modul chain | Order SETTLED menulis `chain_jobs` sekali; antarmuka tertulis di DESIGN §7 | `feat(api): outbox chain` |
| 11 | Pencairan | Simulasi payout + `markPayout` job; spike Iris dicatat hasilnya | `feat(api): simulasi payout` |
| 12 | Rekonsiliasi | Endpoint laporan mencocokkan orders ↔ gateway ↔ chain | `feat(api): rekonsiliasi` |
| 13 | Skenario uji | Sukses, gagal, kedaluwarsa, webhook duplikat, signature salah, jumlah tidak cocok, chain gagal | `test(api): skenario payment` |
| 14 | Dokumentasi | API (markdown/OpenAPI), ERD (Mermaid), catatan penggunaan AI | `docs: API dan ERD` |

## Urutan dan alasan
- Langkah 1 lebih dulu karena jalur frontend dan kontrak bergantung pada antarmuka v1.
- Langkah 2 sebelum 3 sampai 14 karena spike webhook adalah titik risiko terbesar (tunnel + signature).
- Langkah 5 sebelum 8 dan 9: semua perubahan status harus lewat satu modul.
- Langkah 10 hanya menulis outbox. Mengirim ke Sepolia adalah jalur smart contract.

## Prioritas bila waktu mepet
1. Checkout + webhook aman + status pesanan (langkah 2 sampai 9)
2. Outbox ke chain (10)
3. Rekonsiliasi dan skenario uji (12, 13)
4. Simulasi payout (11)
5. Dokumentasi (14) — dikerjakan sambil jalan, jangan ditunda ke akhir

## Yang butuh aksi manual
- Dashboard Midtrans: pastikan Notification URL tersimpan dan lihat notification history (langkah 2).
- Perbarui Notification URL setiap tunnel Cloudflared restart.
- Nyalakan Docker Desktop untuk Postgres (langkah 4).
- Isi Server Key di `.env` sendiri. Kunci tidak boleh dikirim ke chat.

## Status (2026-11-08)
Kode langkah 0-12 dan dokumentasi (14) sudah ditulis dan di-commit. Tes otomatis (langkah 13) sengaja ditunda atas permintaan, jadi belum ada tes.

| Langkah | Status |
|---|---|
| 0, 1 | Selesai |
| 2 Spike webhook | Selesai dan terverifikasi (2026-11-08): webhook pending dan settlement masuk lewat tunnel, signature valid, status pengiriman Completed. Signature dihitung dari Signature Secret Key (`MIDTRANS_SIGNATURE_KEY`), bukan Server Key |
| 3 Struktur | Selesai |
| 4 Database | Selesai, migrasi berhasil dijalankan |
| 5 Mesin status | Selesai |
| 6 API circles | Selesai, terverifikasi smoke test (daftar, buat, tambah anggota, mulai, otorisasi) |
| 7 Tagihan | Selesai |
| 8 Checkout | Selesai, terverifikasi smoke test (token Snap, idempoten, 403 anggota lain, 409 sudah bayar) |
| 9 Webhook | Selesai, terverifikasi: pembayaran di simulator mengubah order jadi SETTLED lewat webhook dan membuat job outbox |
| 10 Outbox | Selesai. Dipakai modul chain dari jalur kontrak |
| 11 Payout | Simulasi selesai dan terverifikasi (`-Both`): ditolak sebelum semua lunas, dana Rp20.000 tanpa biaya admin, payout ganda ditolak, periode 2 dibuka. Iris ditulis dari dokumentasi, belum diuji |
| 12 Rekonsiliasi | Selesai, terverifikasi tanpa live (issues=0). Mode live belum dicoba |
| 13 Tes | Ditunda |
| 14 Dokumentasi | Selesai: `API.md`, `ERD.md`, `DESIGN.md`, `apps/api/README.md` |

## Yang masih perlu dibuktikan (belum pernah dijalankan)
Kode ditulis tanpa bisa dikompilasi atau dijalankan di lingkungan pengembangan. Urutan verifikasi: `npm install` → `npm run typecheck` → `docker compose up -d` → `npm run migrate` → uji spike webhook → uji alur penuh (daftar, buat kelompok, mulai, checkout, bayar di simulator, cek `GET /orders/:orderId`).

## Catatan hasil uji spike (2026-11-08)
- `typecheck` dan `migrate` berhasil di komputer pengembang.
- Dashboard Midtrans kelompok memisahkan **Server Key** (autentikasi API) dari **Signature Secret Key** (signature notifikasi dan Status API). Server Key terbukti valid untuk Snap dan Status API, tetapi tidak cocok untuk signature.
- Notification URL sempat tersimpan tanpa path; server menerima notifikasi di `POST /` dan `POST /midtrans-webhook`.
- Panggilan keluar ke Midtrans dipaksa IPv4 dengan retry (`src/lib/http.ts`) karena Node sempat timeout padahal PowerShell bisa terhubung. Panggilan pertama ke Snap masih bisa lambat (sekitar 11 detik pada satu percobaan).

## Hasil smoke test (2026-11-08, `scripts/smoke.ps1`, tanpa -Both)
Semua 19 pemeriksaan lolos: health, register/login, buat dan mulai kelompok, checkout idempoten, otorisasi (403), pembayaran di simulator terdeteksi (SETTLED), pembayaran ganda ditolak (409), job chain `queued` di outbox, rekonsiliasi `issues=0`.

Belum pernah dijalankan: mode `-Both` (pembayaran kedua, periode siap cair, payout simulasi, periode 2 dibuka), penalti keterlambatan, order FAILED/EXPIRED, notifikasi duplikat, rekonsiliasi `live=true`, Iris, dan konsumsi outbox oleh modul chain (job masih `queued`).

## Hasil smoke test -Both (2026-11-08)
Semua 30 pemeriksaan lolos: dua anggota membayar lewat simulator, periode 1 menjadi siap cair, payout simulasi Rp20.000 (iuran saja, tanpa biaya admin), payout ganda ditolak (409), periode 2 dibuka, selisih terkumpul vs dicairkan 0, rekonsiliasi akhir `issues=0`.

Masih belum pernah dijalankan: penalti keterlambatan, order FAILED/EXPIRED, notifikasi duplikat, rekonsiliasi `live=true`, Iris, dan konsumsi outbox oleh modul chain (job `recordPayment` dan `markPayout` masih `queued`).
