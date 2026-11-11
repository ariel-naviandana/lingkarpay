# apps/web — jalur frontend

Folder ini milik jalur frontend. Kerangka awal sudah disiapkan (lihat bagian "Kerangka awal" di bawah). Disarankan Vite + React + TypeScript, `viem` untuk membaca contract.

## Halaman yang dibutuhkan
Login/daftar, dashboard kelompok, buat kelompok dan undang anggota, detail kelompok (status periode, siapa sudah bayar, giliran, penalti), halaman bayar iuran (Snap), riwayat pembayaran dan status pencairan, portal verifikasi publik (baca dari contract), opsional halaman operator (rekonsiliasi).

## Memakai API backend
Dokumen: `docs/API.md` (endpoint, bentuk body dan respons), `docs/DESIGN.md`, dan `docs/openapi.yaml` (impor ke Postman, atau buka di editor.swagger.io untuk mencoba endpoint). Backend jalan di `http://localhost:3001`.

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

## Kerangka awal (sudah disiapkan)
Vite + React + TypeScript. **Belum pernah dijalankan atau dikompilasi**; versi paket dapat disesuaikan. Mulai dengan:
```powershell
cd C:\coding\lingkarpay\apps\web
npm install
npm run typecheck
npm run dev          # http://localhost:5173 (backend harus jalan di :3001)
```
Salin `.env.example` ke `.env` untuk portal verifikasi.

| File | Isi | Status |
|---|---|---|
| `src/api.ts`, `src/types.ts` | Klien API (token Bearer, error seragam) dan tipe dari `docs/openapi.yaml` | Ada |
| `src/auth.tsx`, `src/pages/Login.tsx` | Login/daftar, sesi di `localStorage` | Ada |
| `src/pages/Dashboard.tsx` | Daftar kelompok, buat kelompok | Ada |
| `src/pages/CircleDetail.tsx` | Anggota dan status iuran periode berjalan, undang anggota, mulai kelompok, tombol bayar | Ada (dasar) |
| `src/components/PayButton.tsx` | Alur Snap: `/public-config` → `/checkout` → `snap.pay` → polling `/orders/:id` | Ada |
| `src/pages/Verify.tsx` | Portal verifikasi publik: baca contract dengan `viem` | Dasar |

### Yang menjadi pekerjaan jalur ini (TODO)
Cari `TODO(frontend)` di kode:
1. Tabel semua periode dan penerimanya; riwayat pembayaran dan status pencairan (`api.payments`).
2. Halaman/tombol operator: pencairan (`api.simulatePayout`), laporan rekonsiliasi (`api.reconciliation`).
3. Portal verifikasi lengkap: status iuran per anggota per periode, penerima, penalti, tautan transaksi ke Etherscan Sepolia.
4. Tampilan yang layak: pesan error, loading, responsif, penanganan status `SETTLED_PENDING_CHAIN`, callback Snap (`onClose`).
5. User stories dan kriteria penerimaan (tulis di `docs/`), uji end to end, video demo.
Catatan: portal verifikasi baru berguna setelah contract ter-deploy dan `circles.chain_circle_id` terisi oleh modul chain.
