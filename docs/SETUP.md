# SETUP: menjalankan LingkarPay dari nol

Panduan untuk anggota tim yang baru clone repo. Semua memakai sandbox dan testnet dengan data dummy. Jangan memakai uang sungguhan.

## Pilih sesuai peran

| Peran | Yang perlu dijalankan |
|---|---|
| Frontend | Langkah 1 sampai 4 |
| Business case | Tidak perlu menjalankan kode. Baca `docs/DESIGN.md`, `docs/RULES.md`, `docs/BUKTI_SEPOLIA.md`, `docs/PLAN.md`; hasil ditaruh di `business-case/` |
| Smart contract / worker chain | Langkah 1 sampai 3, lalu langkah 6 |

## 0. Prasyarat (sekali saja)
- Git.
- Node 22 LTS (Node 23 jalan tapi memunculkan peringatan `EBADENGINE`).
- Docker Desktop, harus menyala.
- Akun GitHub yang sudah jadi collaborator repo.
- Akun Midtrans sandbox sendiri (gratis) di https://dashboard.sandbox.midtrans.com, untuk mendapat key.

## 1. Clone dan identitas git
```powershell
git clone https://github.com/ariel-naviandana/lingkarpay
cd lingkarpay
git config user.name "Nama Anda"
git config user.email "email-yang-terdaftar-di-github"
```
Dua baris `git config` wajib. Riwayat commit per anggota ikut dinilai, jadi commit harus atas nama masing-masing.

## 2. Database
Dari root repo:
```powershell
docker compose up -d
```
Postgres berjalan di port 5433.

## 3. Backend
```powershell
cd apps\api
npm install
copy .env.example .env
```
Isi `.env` sendiri:
- `DATABASE_URL`: pakai nilai contoh dari `.env.example`.
- `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_SIGNATURE_KEY`: dari dashboard Midtrans sandbox (Settings > Access Keys). `MIDTRANS_SIGNATURE_KEY` adalah *Signature Secret Key*, bukan Server Key. Server Key harus punya izin Snap Checkout, Core API, Cancel, dan Expire = Write.
- Rahasia hanya ada di `.env`. Jangan di-commit dan jangan dikirim lewat chat. `.env` sudah ada di `.gitignore`; periksa dengan `git status` sebelum commit.

Lalu:
```powershell
npm run migrate
npm run typecheck
npm test            # 101 tes harus lulus
npm run dev         # http://localhost:3001
```
Setiap `.env` berubah, restart `npm run dev` (tidak dimuat ulang otomatis).

Kalau `npm run migrate` gagal dengan "Connection terminated", Postgres belum siap. Tunggu beberapa detik lalu ulangi.

## 4. Frontend
Terminal baru (backend tetap jalan):
```powershell
cd apps\web
npm install
copy .env.example .env
npm run typecheck
npm run dev         # http://localhost:5173
```
- Kontrak API: `docs/openapi.yaml` dan `docs/API.md`.
- Daftar yang harus dikerjakan: `apps/web/README.md` (cari `TODO(frontend)`).
- Frontend tidak butuh blockchain. Tanpa worker, job chain hanya mengantre dan alur pembayaran tetap normal.

## 5. Uji end to end dengan Midtrans sandbox (opsional)
```powershell
cd apps\api
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both
```
Skrip meminta bayar lewat halaman Snap: pilih Bank Transfer > BCA, catat nomor VA, lalu bayar di https://simulator.sandbox.midtrans.com (Virtual Account > BCA). Hindari QRIS di sandbox.

Skenario kuorum: `scripts\smoke-quorum.ps1` (tambah `-WaitChain` bila worker chain menyala).

## 6. Smart contract dan worker chain
Tes contract tidak butuh akun apa pun:
```powershell
cd contracts
npm install
npm test            # 40 tes harus lulus
```
Worker ke Sepolia butuh tiga nilai di `apps/api/.env`: `CHAIN_RPC_URL`, `OPERATOR_PRIVATE_KEY`, `LINGKARPAY_ADDRESS`. Private key operator hanya dipegang pemiliknya dan tidak dibagikan. Pakai akun testnet khusus, bukan akun Hardhat #0. Cara menjalankan worker: `apps/api/src/chain/README.md` dan `docs/DEMO.md`. Deploy dan verifikasi: `contracts/README.md`.

## 7. Alur kerja git
```powershell
git pull --rebase
# kerjakan, satu langkah = satu commit kecil
git add <file>
git commit -m "feat(web): halaman login"
git push
```
- Format pesan commit: `feat(web): ...`, `fix(api): ...`, `docs: ...`.
- Tiap jalur hanya mengubah foldernya sendiri. Perubahan antarmuka lintas jalur dibahas dulu dan dicatat di `docs/DESIGN.md`.
- Tidak ada force push dan tidak menulis ulang riwayat.
- Jika memakai bantuan AI, catat di `docs/AI_STATEMENT.md`.

## Masalah umum
| Gejala | Solusi |
|---|---|
| Server tidak mau start | Ada variabel `.env` wajib yang kurang; pesan error menyebut namanya (tanpa nilainya). |
| Port atau database error | `docker compose up -d`, `npm run migrate`, restart `npm run dev`. |
| `EBADENGINE` saat `npm install` | Peringatan Node 23. Pakai Node 22 LTS bila ada masalah. |
