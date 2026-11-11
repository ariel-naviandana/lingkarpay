# LingkarPay

Dompet arisan digital: iuran dibayar lewat payment gateway (Midtrans sandbox), aturan iuran, giliran, dan penalti ditegakkan smart contract di Ethereum Sepolia. Tugas Akhir mata kuliah Teknologi Blockchain dan Platform Keuangan Digital (FILKOM UB). Seluruhnya sandbox dan testnet dengan data dummy.

## Jalur kerja
| Jalur | Folder | Isi |
|---|---|---|
| Payment gateway | `apps/api/` | API, database, checkout, webhook, tagihan, outbox ke chain, payout, rekonsiliasi |
| Frontend | `apps/web/` | Antarmuka anggota dan operator, halaman bayar (Snap), portal verifikasi publik |
| Smart contract | `contracts/` dan `apps/api/src/chain/` | Contract Solidity, tes, deploy Sepolia, modul chain (worker outbox) |
| Business case | `docs/business-case/` | Dokumen business case, revisi proposal, slide, video demo |

Pembagian orang per jalur: lihat Tabel 25 di proposal. Antarmuka antar jalur ditulis di `docs/` dan jadi kontrak bersama.

## Status
| Jalur | Status |
|---|---|
| Payment gateway (`apps/api`) | Selesai dan terverifikasi: 101 tes, smoke test (alur penuh dan kuorum), skenario Midtrans sandbox. Rincian: `docs/PLAN.md` |
| Smart contract (`contracts/`, `apps/api/src/chain/`) | Selesai: contract lengkap termasuk kuorum (40 tes), ter-deploy di Sepolia (v2), worker chain idempoten; terbukti end to end dengan hash transaksi (`docs/BUKTI_SEPOLIA.md`) |
| Frontend (`apps/web/`) | Kerangka awal disiapkan (belum dijalankan); halaman lanjutan ditandai `TODO(frontend)` |
| Business case (`docs/business-case/`) | Belum dimulai; daftar isi dan angka prototipe tersedia |

## Struktur
```
lingkarpay/
├── README.md                  ini
├── docker-compose.yml         Postgres lokal (port 5433)
├── apps/
│   ├── api/                   jalur payment gateway (Fastify + TypeScript + Postgres)
│   │   ├── src/               config, routes, services, db, test
│   │   ├── src/chain/         modul chain: worker outbox -> contract (jalur smart contract)
│   │   ├── db/migrations/     skema SQL
│   │   └── scripts/           smoke test PowerShell (alur penuh, skenario)
│   └── web/                   jalur frontend (Vite + React, kerangka awal)
├── contracts/                 jalur smart contract (Hardhat: contract, tes, deploy Sepolia)
│   └── deployments/           alamat dan ABI hasil deploy Sepolia
└── docs/
    ├── DESIGN.md              rancangan antarmuka v1 (kontrak antar jalur)
    ├── API.md, openapi.yaml   endpoint backend (teks dan OpenAPI)
    ├── ERD.md                 skema database
    ├── RULES.md               aturan kerja
    ├── PLAN.md                status dan bukti pengerjaan
    ├── DEMO.md                runbook demo dan progress report
    ├── IRIS.md                payout Midtrans Iris (opsional)
    ├── DEV_LOG.md             log pengembangan ide dan keputusan
    ├── AI_STATEMENT.md        pernyataan penggunaan alat AI
    └── business-case/         jalur business case
```

## Alur data (ringkas)
```
Frontend ─ POST /checkout ─▶ API ─▶ Midtrans Snap ─ bayar di simulator
Midtrans ─ webhook ─▶ API (signature, dedupe, cek jumlah) ─▶ order SETTLED ─▶ chain_jobs (outbox)
modul chain ─ claimJobs ─▶ recordPayment di Sepolia ─ markJobConfirmed ─▶ order ANCHORED
Portal verifikasi ─ baca langsung dari contract (bukan dari database)
```

## Menjalankan
```powershell
docker compose up -d          # Postgres, di root repo
cd apps\api; npm install; npm run migrate; npm run dev     # backend, http://localhost:3001
cd apps\web; npm install; npm run dev                       # frontend, http://localhost:5173 (kerangka)
```
Rincian, termasuk `.env` dan uji dengan Midtrans sandbox: `apps/api/README.md`. Contract: `contracts/README.md`.

## Konvensi
- Satu langkah pekerjaan = satu commit kecil, lalu push. Pesan commit: `feat(api): ...`, `fix(web): ...`, `test(contracts): ...`, `docs: ...`.
- Tiap jalur hanya mengubah foldernya sendiri. Perubahan antarmuka lintas jalur dibicarakan dulu lalu dicatat di `docs/DESIGN.md`.
- `git pull --rebase` sebelum push. Tidak ada force push dan tidak menulis ulang riwayat (riwayat per anggota dinilai).
- Rahasia (Server Key, Signature Secret Key, private key penanda tangan) hanya di `.env` masing-masing, tidak pernah di commit atau chat. Hanya sandbox dan testnet. Hindari QRIS di sandbox.
- Aturan lengkap: `docs/RULES.md`.
