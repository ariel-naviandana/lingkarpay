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

## Struktur
```
lingkarpay/
├── README.md                  ini
├── docker-compose.yml         Postgres lokal (port 5433)
├── apps/
│   ├── api/                   jalur payment gateway (Fastify + TypeScript + Postgres)
│   │   ├── src/chain/         modul chain: worker outbox → contract (jalur smart contract)
│   │   ├── src/routes|services|db|lib
│   │   ├── db/migrations/     skema SQL
│   │   └── scripts/smoke.ps1  uji alur penuh
│   └── web/                   jalur frontend
├── contracts/                 jalur smart contract (Hardhat)
│   └── deployments/           alamat dan ABI hasil deploy Sepolia
└── docs/
    ├── DESIGN.md              rancangan antarmuka v1 (kontrak antar jalur)
    ├── API.md                 endpoint backend
    ├── ERD.md                 skema database
    ├── RULES.md               aturan kerja
    ├── PLAN.md                rencana dan status pengerjaan
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
Backend: lihat `apps/api/README.md`. Postgres: `docker compose up -d` di root.
Frontend dan contract: lihat README di foldernya masing-masing.

## Konvensi
- Satu langkah pekerjaan = satu commit kecil, lalu push. Pesan commit: `feat(api): ...`, `fix(web): ...`, `test(contracts): ...`, `docs: ...`.
- Tiap jalur hanya mengubah foldernya sendiri. Perubahan antarmuka lintas jalur dibicarakan dulu lalu dicatat di `docs/DESIGN.md`.
- `git pull --rebase` sebelum push. Tidak ada force push dan tidak menulis ulang riwayat (riwayat per anggota dinilai).
- Rahasia (Server Key, Signature Secret Key, private key penanda tangan) hanya di `.env` masing-masing, tidak pernah di commit atau chat. Hanya sandbox dan testnet. Hindari QRIS di sandbox.
- Aturan lengkap: `docs/RULES.md`.
