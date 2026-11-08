# apps/web — jalur frontend

Belum dimulai. Folder ini milik jalur frontend. Disarankan Vite + React + TypeScript, `viem` untuk membaca contract.

## Halaman yang dibutuhkan
Login/daftar, dashboard kelompok, buat kelompok dan undang anggota, detail kelompok (status periode, siapa sudah bayar, giliran, penalti), halaman bayar iuran (Snap), riwayat pembayaran dan status pencairan, portal verifikasi publik (baca dari contract), opsional halaman operator (rekonsiliasi).

## Memakai API backend
Dokumen: `docs/API.md` (endpoint, bentuk body dan respons) dan `docs/DESIGN.md`. Backend jalan di `http://localhost:3001`.

| Kebutuhan | Endpoint |
|---|---|
| Login / daftar | `POST /auth/login`, `POST /auth/register`, `GET /auth/me` (token `Bearer`) |
| Dashboard dan detail | `GET /circles`, `GET /circles/:id` |
| Buat, undang, mulai | `POST /circles`, `POST /circles/:id/members`, `POST /circles/:id/start` |
| Bayar iuran | `GET /public-config` (client key + URL snap.js) → `POST /checkout` → `snap.pay(token)` → polling `GET /orders/:orderId` |
| Riwayat | `GET /circles/:id/payments` |
| Operator | `POST /payouts/simulate`, `GET /reports/reconciliation?circleId=` |
| Portal verifikasi | baca contract langsung; alamat dan ABI dari `contracts/deployments/sepolia.json`, id kelompok dari `chainCircleId` di `GET /circles/:id` |

Catatan penting untuk halaman bayar:
- Status bayar hanya dari `GET /orders/:orderId` (sumber kebenaran: webhook). Halaman redirect Midtrans hanya tampilan.
- Status order: `PENDING`, `SETTLED`, `SETTLED_PENDING_CHAIN`, `ANCHORED`, `FAILED`, `EXPIRED`. `SETTLED` sudah berarti sah dibayar; `ANCHORED` berarti sudah tercatat di Sepolia.
- Tampilkan rincian dari respons checkout: `amount`, `penaltyAmount`, `adminFee`, `grossAmount`.
- Pengguna tidak memegang dompet kripto. Hanya `memberRef` (ID samaran) yang tampil on-chain.

## CORS
Backend belum memasang CORS. Pakai proxy dev Vite agar frontend memanggil `/api` tanpa CORS:
```ts
// vite.config.ts
server: { proxy: { "/api": { target: "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") } } }
```
Kalau butuh CORS sungguhan, minta jalur payment gateway menambahkan `@fastify/cors`.

## Sebelum bisa mencoba
Buat data lewat `apps/api/scripts/smoke.ps1`, atau lewat API langsung. Bayar hanya lewat simulator Midtrans (VA).
