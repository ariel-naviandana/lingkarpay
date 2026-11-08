# LingkarPay API

Backend payment gateway (Midtrans sandbox) dan outbox ke modul chain. Rancangan: `../../docs/DESIGN.md`. Endpoint: `../../docs/API.md`.

## Menjalankan (Windows PowerShell)
```powershell
cd C:\coding\lingkarpay
docker compose up -d                      # Postgres di port 5433
cd apps\api
npm install
npm run typecheck
npm run migrate                           # membuat tabel
npm run dev                               # http://localhost:3001
```

## .env
Salin `.env.example` ke `.env`, lalu isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` sendiri (jangan dikirim ke chat atau di-commit). Tambahkan baris `DATABASE_URL` dari `.env.example`. Isi juga `MIDTRANS_SIGNATURE_KEY` dengan Signature Secret Key dari Settings > Access Keys (dipakai memverifikasi signature notifikasi dan Status API). Restart `npm run dev` setiap `.env` berubah. Server menolak start bila ada variabel wajib yang kurang.

## Uji spike webhook
```powershell
cloudflared tunnel --url http://localhost:3001
```
1. Isi Notification URL di dashboard Midtrans dengan `https://<tunnel>/midtrans-webhook` (berubah tiap restart tunnel).
2. Buka `http://localhost:3001/`, klik Bayar, selesaikan di simulator (VA, bukan QRIS).
3. Lihat log server: `webhook diproses ... outcome: unknown_order` berarti signature valid dan transaksi `TEST-...` tercatat. Cek juga `http://localhost:3001/status/<orderId>`: `signatureValid: true` membuktikan rumus signature benar.
4. Tombol "Test notification URL" mengirim contoh dengan signature palsu, jadi 401 itu wajar.

## Struktur
```
src/config.ts        env tervalidasi
src/app.ts           Fastify + error handler
src/routes/          HTTP tipis
src/services/        logika (orderStatus, billing, checkout, webhook, outbox, payouts, reconciliation, ...)
src/db/              pool, migrasi
db/migrations/       SQL berurutan
```
Perubahan status order hanya lewat `src/services/orderStatus.ts`.
