# Status dan Rencana — Jalur Payment Gateway

Acuan: 11 November 2026. Tenggat: progress report di kelas sebelum 24 November, business case 24 November, pembekuan prototipe 25 November, presentasi 26 November sampai 15 Desember (pengurangan nilai mulai 3 Desember).

## Ringkasan
Seluruh tugas jalur payment gateway selesai dan terverifikasi, begitu juga sambungan ke smart contract: `npm run typecheck` bersih, 101 tes backend dan 40 tes contract lulus, smoke test alur penuh dan kuorum lolos, lima skenario pembayaran terbukti di Midtrans sandbox, dan alur lengkap **bayar fiat → webhook → server memanggil smart contract → tercatat di Ethereum Sepolia** terbukti dengan hash transaksi (`docs/BUKTI_SEPOLIA.md`). Yang tersisa hanya hal opsional dan hal yang menjadi tugas jalur lain (frontend dan business case).

## Langkah pengerjaan
| # | Langkah | Status | Bukti |
|---|---|---|---|
| 0 | Baseline repo | Selesai | Remote, `.gitignore`, `.env` tidak terlacak |
| 1 | Aturan, rancangan, rencana | Selesai | `RULES.md`, `DESIGN.md`, `PLAN.md` |
| 2 | Spike webhook | Selesai | Webhook masuk lewat tunnel; signature valid; status pengiriman Completed |
| 3 | Struktur proyek | Selesai | `config` tervalidasi, `routes/services/db/lib`, `tsconfig` |
| 4 | Database | Selesai | Migrasi 001, 002, dan 003 |
| 5 | Mesin status pesanan | Selesai | Tes unit semua transisi |
| 6 | API kelompok, anggota, periode, auth | Selesai | Smoke test |
| 7 | Tagihan (iuran + penalti + biaya admin) | Selesai | Tes unit, tes integrasi, smoke test |
| 8 | Checkout idempoten | Selesai | Smoke test, tes (termasuk dua checkout serentak) |
| 9 | Webhook aman | Selesai | Sandbox sungguhan; tes duplikat, serentak, signature palsu, jumlah tidak cocok, tidak berurutan |
| 10 | Outbox ke modul chain | Selesai | Enam jenis job; terbukti dikonsumsi worker di Sepolia |
| 11 | Pencairan | Simulasi selesai | Smoke test `-Both` dan `smoke-quorum`. Iris ditulis dari dokumentasi, belum diuji (opsional, lihat `IRIS.md`) |
| 12 | Rekonsiliasi | Selesai | Tes dan smoke test. Mode `live=true` belum dicoba |
| 13 | Tes otomatis | Selesai | 101 tes backend, 18 suite, 0 gagal |
| 14 | Dokumentasi | Selesai | `API.md`, `openapi.yaml`, `ERD.md`, `DESIGN.md`, `DEV_LOG.md`, `AI_STATEMENT.md`, `DEMO.md`, `PENJELASAN_KODE.md`, `BUKTI_SEPOLIA.md`, README tiap jalur |
| + | Cancel dan expire lewat API | Selesai | Terbukti di sandbox (butuh izin Capability pada server key) |
| + | Smart contract LingkarPay | Selesai | 40 tes; ter-deploy di Sepolia (v2) |
| + | Worker chain idempoten | Selesai | Melanjutkan dari state contract; terbukti di Sepolia |
| + | Kuorum (usulan tutup periode) di backend | Selesai | 8 tes integrasi + `smoke-quorum.ps1` (15 pemeriksaan) + terbukti di Sepolia |

## Verifikasi
Perintah dijalankan dari `apps\api` (Windows PowerShell). Tes backend membutuhkan Postgres (`docker compose up -d`).

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Tipe backend | `npm run typecheck` | Bersih |
| Tes backend | `npm test` | 101 lulus |
| Tes contract | `npm test` (folder `contracts`) | 40 lulus |
| Alur penuh, satu anggota | `scripts\smoke.ps1` | 19 pemeriksaan lolos |
| Alur penuh, dua anggota + pencairan | `scripts\smoke.ps1 -Both` | 30 pemeriksaan lolos |
| Kuorum + pencairan + chain | `scripts\smoke-quorum.ps1 -WaitChain` | 15 pemeriksaan lolos; semua job outbox `confirmed` di Sepolia |

Skenario pembayaran di Midtrans sandbox:

| Skenario | Perintah | Hasil |
|---|---|---|
| Sukses VA BCA | `smoke.ps1 -Both` | Lolos |
| Sukses e-wallet | `smoke-scenarios.ps1 -Scenario Ewallet` | Lolos (GoPay lewat simulator; Midtrans melaporkan `payment_type=qris`) |
| Kedaluwarsa | `smoke-scenarios.ps1 -Scenario Expire -ApiExpire` | Lolos (EXPIRED, order baru bisa dibuat) |
| Dibatalkan | `smoke-scenarios.ps1 -Scenario Cancel -ApiCancel` | Lolos (FAILED, order baru bisa dibuat) |
| Duplikat, signature palsu, jumlah tidak cocok, tidak berurutan | `npm test` | Lolos |

## Smart contract dan modul chain
Contract `0x87eD2019c518e0309BddCB4AA7F2c375F1aE04B2` di Sepolia (v2, final); riwayat v1 di `contracts/deployments/`. Worker (`apps/api/src/chain/worker.ts`) mencatat `createCircle`, `recordPayment`, `markPayout`, `proposeClosePeriod`, `castVote`, dan `executeProposal`; order menjadi `ANCHORED`. Rincian dan hash transaksi: `docs/BUKTI_SEPOLIA.md`. Kode contract terverifikasi di Etherscan (Exact Match), Blockscout, dan Sourcify, sehingga daftar transaksi menampilkan nama fungsi.

Kuorum: usulan menutup periode yang iurannya belum lengkap (mayoritas mutlak, satu anggota satu suara, batas voting 3 hari). Contract mendukung juga usulan mengganti anggota, tetapi itu belum terhubung ke backend.

## Belum dibuktikan atau opsional
- **Iris (payout sandbox):** butuh akun sandbox Iris dan dua kunci. Simulasi pencairan sudah memenuhi alur tugas.
- **Rekonsiliasi `live=true`** (cek ke Status API): kodenya ada, belum dicoba.
- **Penalti keterlambatan di sandbox:** terbukti di tes otomatis (backend dan contract), belum pada transaksi sandbox sungguhan (tenggat di smoke test 7 hari).
- **Ganti anggota lewat kuorum:** hanya di contract dan tesnya, belum di backend (menyentuh tagihan, order, dan checkout).
- **Frontend dan business case:** tugas jalur lain (kerangka frontend sudah disiapkan).

## Antarmuka dengan jalur lain
- **Frontend:** `docs/openapi.yaml` dan `docs/API.md`; panduan di `apps/web/README.md` (termasuk endpoint kuorum).
- **Smart contract:** selesai; antarmuka outbox di `apps/api/src/services/outbox.ts` dan `docs/DESIGN.md` bagian 7.
- **Business case:** angka prototipe di `docs/business-case/README.md`.

## Catatan teknis yang berdampak
- **Signature Secret Key.** Signature notifikasi dan Status API dihitung dari Signature Secret Key (`MIDTRANS_SIGNATURE_KEY`), bukan Server Key.
- **Izin server key.** Snap Checkout, Core API, Cancel transaction, dan Expire transaction harus Write. Tanpa izin Capability, cancel dan expire dijawab `403 Access denied`. Refund tidak diaktifkan.
- **Notification URL.** Alamat tunnel Cloudflared berubah tiap restart; perbarui di dashboard Midtrans. Server menerima notifikasi di `/midtrans-webhook` dan `POST /`.
- **Zod 4.** Nilai bawaan boolean di `.env` dipasang sebelum konversi (lihat `src/config.schema.ts` dan tesnya).
- **Reload `.env` dan worker.** `tsx watch` tidak memuat ulang saat `.env` berubah, dan `npm run chain:worker` tidak memuat ulang sama sekali; restart setelah `.env` atau kode berubah. Log start menampilkan sidik jari key dan alamat contract untuk memastikan yang termuat.
- **Contract dan worker harus cocok versinya.** Worker baru ke contract lama gagal; saat contract di-deploy ulang, kosongkan database dev (id kelompok on-chain berubah).
- **Satu set `.env` aktif.** Jangan ada baris ganda untuk `CHAIN_NAME`, `CHAIN_RPC_URL`, `OPERATOR_PRIVATE_KEY`, `LINGKARPAY_ADDRESS`.
