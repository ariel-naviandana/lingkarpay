# LingkarPay API

Backend payment gateway (Midtrans sandbox) dan outbox ke modul chain. Rancangan: `../../docs/DESIGN.md`. Endpoint: `../../docs/API.md` dan `../../docs/openapi.yaml`. Status dan bukti: `../../docs/PLAN.md`.

## Menjalankan (Windows PowerShell)
```powershell
cd C:\coding\lingkarpay
docker compose up -d                      # Postgres di port 5433
cd apps\api
npm install
npm run typecheck
npm run migrate                           # membuat tabel
npm test                                  # 87 tes (butuh Postgres)
npm run dev                               # http://localhost:3001
```

## .env
Salin `.env.example` ke `.env`, lalu isi sendiri (jangan dikirim ke chat atau di-commit):
- `DATABASE_URL` (nilai contoh ada di `.env.example`).
- `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`.
- `MIDTRANS_SIGNATURE_KEY`: Signature Secret Key dari Settings > Access Keys. Dipakai memverifikasi signature notifikasi dan Status API.

Server menolak start bila ada variabel wajib yang kurang. **Restart `npm run dev` setiap `.env` berubah** (`tsx watch` tidak memuat ulang karena `.env`). Log start menampilkan sidik jari key (`server_key_fp`) untuk memastikan yang termuat.

Izin Server Key (Settings > Access Keys > Generate server key): **Snap Checkout = Write**, **Core API = Write**, serta Capability **Cancel transaction = Write** dan **Expire transaction = Write** (bawaannya None; tanpa ini cancel/expire dijawab `403 Access denied`). Refund dan produk lain tidak perlu diaktifkan.

## Uji spike webhook
```powershell
cloudflared tunnel --url http://localhost:3001
```
1. Isi Notification URL di dashboard Midtrans dengan `https://<tunnel>/midtrans-webhook` (berubah tiap restart tunnel; server juga menerima `POST /`).
2. Buka `http://localhost:3001/`, klik Bayar, selesaikan di simulator (VA, bukan QRIS).
3. Log server: `webhook diproses ... outcome: unknown_order` berarti signature valid dan transaksi `TEST-...` tercatat. `http://localhost:3001/status/<orderId>` dengan `signatureValid: true` membuktikan rumus signature benar.
4. Tombol "Test notification URL" mengirim contoh dengan signature palsu, jadi 401 itu wajar.

## Uji alur penuh dan skenario
Skrip membuat pengguna dan kelompok dummy lewat API, membuka halaman Snap, lalu menunggu pembayaran di simulator Midtrans. Hasil tiap pemeriksaan dicetak sebagai PASS/FAIL.
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1                  # satu anggota membayar
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both            # dua anggota + pencairan simulasi
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Ewallet
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Expire -ApiExpire
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-scenarios.ps1 -Scenario Cancel -ApiCancel
```
`Expire` tanpa `-ApiExpire` menunggu notifikasi kedaluwarsa asli dari Midtrans (set `ORDER_EXPIRY_MINUTES=5` dan restart server). Pencairan lewat Iris: `docs/IRIS.md`. Runbook demo: `docs/DEMO.md`.

## Struktur
```
src/config.schema.ts  skema dan validasi env (murni, dites)
src/config.ts         memuat .env lalu memvalidasi
src/app.ts            Fastify, error handler, parser JSON
src/routes/           HTTP tipis
src/services/         logika (orderStatus, billing, checkout, webhook, gatewayStatus, orders, outbox, payouts, reconciliation, midtrans, iris, ...)
src/db/               pool, migrasi
src/chain/            modul chain (jalur smart contract; kerangka worker.example.ts)
src/test/             helper dan tes integrasi (database lingkarpay_test)
db/migrations/        SQL berurutan (001, 002)
scripts/              smoke test PowerShell
```
Perubahan status order hanya lewat `src/services/orderStatus.ts`. Tes memakai database terpisah `lingkarpay_test` (dibuat otomatis; menolak berjalan bila namanya tidak berakhiran `_test`) dan key palsu.
