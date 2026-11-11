# Status dan Rencana — Jalur Payment Gateway

Acuan: 8 November 2026. Tenggat: progress report di kelas sebelum 24 November, business case 24 November, pembekuan prototipe 25 November, presentasi 26 November sampai 15 Desember (pengurangan nilai mulai 3 Desember).

## Ringkasan
Seluruh tugas jalur payment gateway sudah selesai dan terverifikasi di komputer pengembang dan di Midtrans sandbox: `npm run typecheck` bersih, `npm test` 87 lulus, dua smoke test alur penuh lolos, dan lima skenario pembayaran terbukti di sandbox sungguhan. Alur lengkap sampai tercatat di Ethereum Sepolia juga sudah terbukti (`docs/BUKTI_SEPOLIA.md`). Yang tersisa hanya hal opsional dan hal yang bergantung pada jalur lain (lihat bagian bawah).

## Langkah pengerjaan
| # | Langkah | Status | Bukti |
|---|---|---|---|
| 0 | Baseline repo | Selesai | Remote, `.gitignore`, `.env` tidak terlacak |
| 1 | Aturan, rancangan, rencana | Selesai | `RULES.md`, `DESIGN.md`, `PLAN.md` |
| 2 | Spike webhook | Selesai | Webhook pending dan settlement masuk lewat tunnel; signature valid; status pengiriman Completed |
| 3 | Struktur proyek | Selesai | `config` tervalidasi, `routes/services/db/lib`, `tsconfig` |
| 4 | Database | Selesai | Migrasi 001 dan 002 diterapkan |
| 5 | Mesin status pesanan | Selesai | Tes unit semua transisi |
| 6 | API kelompok, anggota, periode, auth | Selesai | Smoke test |
| 7 | Tagihan (iuran + penalti + biaya admin) | Selesai | Tes unit, tes integrasi, smoke test |
| 8 | Checkout idempoten | Selesai | Smoke test, tes (termasuk dua checkout serentak) |
| 9 | Webhook aman | Selesai | Sandbox sungguhan; tes duplikat, serentak, signature palsu, jumlah tidak cocok, tidak berurutan |
| 10 | Outbox ke modul chain | Selesai | Tes; job `createCircle`, `recordPayment`, `markPayout` |
| 11 | Pencairan | Simulasi selesai | Smoke test `-Both`. Iris ditulis dari dokumentasi, belum diuji (opsional, lihat `IRIS.md`) |
| 12 | Rekonsiliasi | Selesai | Tes dan smoke test. Mode `live=true` belum dicoba |
| 13 | Tes otomatis | Selesai | 87 tes, 16 suite, 0 gagal |
| 14 | Dokumentasi | Selesai | `API.md`, `openapi.yaml`, `ERD.md`, `DESIGN.md`, `DEV_LOG.md`, `AI_STATEMENT.md`, `DEMO.md`, README tiap jalur |
| + | Cancel dan expire lewat API | Selesai | Terbukti di sandbox (butuh izin Capability pada server key) |

## Verifikasi
Perintah dijalankan dari `apps\api` (Windows PowerShell). Tes membutuhkan Postgres (`docker compose up -d`).

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Tipe | `npm run typecheck` | Bersih |
| Tes otomatis | `npm test` | 87 lulus |
| Alur penuh, satu anggota | `scripts\smoke.ps1` | 19 pemeriksaan lolos |
| Alur penuh, dua anggota + pencairan | `scripts\smoke.ps1 -Both` | 30 pemeriksaan lolos |

Skenario pembayaran di Midtrans sandbox:

| Skenario | Perintah | Hasil |
|---|---|---|
| Sukses VA BCA | `smoke.ps1 -Both` | Lolos |
| Sukses e-wallet | `smoke-scenarios.ps1 -Scenario Ewallet` | Lolos (GoPay lewat simulator; Midtrans melaporkan `payment_type=qris`) |
| Kedaluwarsa | `smoke-scenarios.ps1 -Scenario Expire -ApiExpire` | Lolos (EXPIRED, order baru bisa dibuat) |
| Dibatalkan | `smoke-scenarios.ps1 -Scenario Cancel -ApiCancel` | Lolos (FAILED, order baru bisa dibuat) |
| Duplikat, signature palsu, jumlah tidak cocok, tidak berurutan | `npm test` | Lolos |

## Belum dibuktikan atau opsional
- **Iris (payout sandbox):** butuh akun sandbox Iris dan dua kunci. Simulasi pencairan sudah memenuhi alur tugas.
- **Rekonsiliasi `live=true`** (cek ke Status API): kodenya ada, belum dicoba.
- **Penalti keterlambatan di sandbox:** terbukti di tes otomatis, belum pada transaksi sandbox sungguhan (tenggat di smoke test 7 hari).

## Antarmuka dengan jalur lain
- **Frontend:** `docs/openapi.yaml` dan `docs/API.md`; panduan di `apps/web/README.md`.
- **Smart contract:** outbox (`apps/api/src/services/outbox.ts`) dengan fungsi `claimJobs`, `markCircleCreated`, `markJobConfirmed`, `markJobFailed`, `requeueJob`; payload di `docs/DESIGN.md` bagian 7. Job pembayaran dan pencairan ditahan sampai kelompoknya on-chain.
- **Business case:** angka prototipe di `docs/business-case/README.md`.
- Keputusan bersama yang masih terbuka: apakah `markPayout` di contract menutup periode sendiri, atau worker memanggil `closePeriod` lebih dulu.

## Smart contract dan modul chain
Terverifikasi end to end di Sepolia (11 Nov 2026): contract `0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0`, 37 test contract lulus (termasuk kuorum), worker (`apps/api/src/chain/worker.ts`) mencatat `createCircle`, `recordPayment`, dan `markPayout`, order menjadi `ANCHORED`. Rincian dan hash transaksi: `docs/BUKTI_SEPOLIA.md`. Kuorum (usul tutup periode dan ganti anggota, mayoritas mutlak, batas voting 3 hari) sudah ada di contract dan dites, tetapi contract yang ter-deploy di Sepolia adalah versi sebelum kuorum dan kuorum belum terhubung ke backend. Yang masih tersisa: deploy ulang untuk memuat kuorum (opsional), idempotensi `createCircle` pada worker, dan verifikasi contract di Etherscan (opsional).

## Frontend (kerangka, belum dijalankan)
`apps/web/` (Vite + React) disiapkan sebagai kerangka; halaman lanjutan ditandai `TODO(frontend)` sebagai pekerjaan jalur frontend.

## Catatan teknis yang berdampak
- **Signature Secret Key.** Signature notifikasi dan Status API dihitung dari Signature Secret Key (`MIDTRANS_SIGNATURE_KEY`), bukan Server Key.
- **Izin server key.** Snap Checkout, Core API, Cancel transaction, dan Expire transaction harus Write. Tanpa izin Capability, cancel dan expire dijawab `403 Access denied`. Refund tidak diaktifkan.
- **Notification URL.** Alamat tunnel Cloudflared berubah tiap restart; perbarui di dashboard Midtrans. Server menerima notifikasi di `/midtrans-webhook` dan `POST /`.
- **Zod 4.** Nilai bawaan boolean di `.env` dipasang sebelum konversi (lihat `src/config.schema.ts` dan tesnya).
- **Reload `.env`.** `tsx watch` tidak memuat ulang saat `.env` berubah; restart `npm run dev`. Log start menampilkan sidik jari key untuk memastikan yang termuat.
