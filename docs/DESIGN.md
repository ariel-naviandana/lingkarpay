# Rancangan Jalur Payment Gateway — Antarmuka v1

Dokumen ini adalah kontrak untuk jalur lain (frontend memakai API ini, smart contract menerima tugas dari outbox). Perubahan setelah disepakati harus dicatat di bagian Riwayat.

## 1. Alur
```
Frontend → POST /checkout → [order PENDING + token Snap] → anggota bayar di simulator
Midtrans → POST /midtrans-webhook → verifikasi signature → cek duplikat → cek jumlah
        → order SETTLED → tulis chain_jobs (outbox)
Modul chain (jalur kontrak) → ambil job → recordPayment ke Sepolia → order ANCHORED
Rekonsiliasi: cocokkan orders ↔ status gateway ↔ chain_transactions
```

## 2. Status pesanan
| Status | Arti |
|---|---|
| PENDING | Order dibuat, token Snap terbit, belum dibayar |
| SETTLED | Webhook valid: pembayaran sukses |
| SETTLED_PENDING_CHAIN | Sudah dibayar, pencatatan on-chain gagal dan sedang diulang |
| ANCHORED | Tercatat di Sepolia (tx terkonfirmasi) |
| FAILED | Ditolak/dibatalkan gateway |
| EXPIRED | Lewat batas waktu bayar |

Transisi yang diizinkan:
- PENDING → SETTLED | FAILED | EXPIRED
- SETTLED → ANCHORED | SETTLED_PENDING_CHAIN
- SETTLED_PENDING_CHAIN → ANCHORED
- FAILED, EXPIRED, ANCHORED: final.

Pemetaan `transaction_status` Midtrans: `settlement` (dan `capture` dengan `fraud_status=accept`) → SETTLED; `pending` → tetap PENDING; `deny`/`cancel`/`failure` → FAILED; `expire` → EXPIRED.

## 3. Skema database (PostgreSQL)
Mengikuti ERD proposal (Gambar 4), ditambah `chain_jobs` sebagai outbox.

- `users(id, name, contact, created_at)` — data dummy.
- `circles(id, name, contribution_amount, period_days, penalty_pct, admin_fee, status, chain_circle_id, created_by, created_at)`
- `members(id, circle_id, user_id, member_ref, turn_order)` — `member_ref` = ID samaran yang dipakai on-chain.
- `periods(id, circle_id, period_no, due_date, status, recipient_member_id)`
- `orders(id, order_id UNIQUE, member_id, period_id, amount, penalty_amount, admin_fee, status, idempotency_key UNIQUE, gateway_ref, snap_token, created_at, updated_at)`
  - `amount` = iuran, `gross` = amount + penalty_amount + admin_fee (BIGINT rupiah).
  - Unik per kombinasi (member_id, period_id) untuk order yang masih PENDING/SETTLED/ANCHORED.
- `webhook_events(id, order_id, payload_hash UNIQUE, signature_valid, processed, received_at)`
- `chain_jobs(id, order_id UNIQUE, payload JSON, status [queued|sent|confirmed|failed], attempts, last_error, created_at)` — antarmuka ke modul chain.
- `chain_transactions(id, order_id, tx_hash, ref_hash, status, attempts, confirmed_at)`
- `payouts(id, period_id, recipient_member_id, amount, status [simulasi], payout_ref_hash)`

Migrasi berupa file SQL berurutan di `apps/api/db/migrations/`.

## 4. Endpoint v1
| Metode | Path | Fungsi |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Akun sederhana (sandbox) |
| POST | `/circles` | Buat kelompok |
| GET | `/circles`, `/circles/:id` | Daftar & detail (status periode, siapa sudah bayar, giliran, penalti) |
| POST | `/circles/:id/members` | Tambah/undang anggota |
| GET | `/circles/:id/periods` | Daftar periode |
| POST | `/checkout` | Buat order PENDING + token Snap. Body: `circleId, periodId, memberId`. Idempoten. |
| POST | `/midtrans-webhook` | Penerima notifikasi Midtrans |
| GET | `/orders/:orderId` | Status order di database |
| GET | `/status/:orderId` | Cek ke Status API Midtrans + verifikasi signature (bukti rumus benar) |
| GET | `/circles/:id/payments` | Riwayat pembayaran dan pencairan |
| POST | `/payouts/simulate` | Simulasi pencairan periode yang siap cair |
| GET | `/reports/reconciliation` | Laporan pencocokan |

Format error seragam: `{ "error": { "code": "...", "message": "..." } }`.

## 5. Tagihan
`gross_amount = iuran + penalti terutang + biaya admin`. Penalti pada akhirnya dihitung kontrak; selama kontrak belum siap, backend memakai aturan yang sama (persen × iuran bila lewat tenggat) lewat satu fungsi `computePenalty` yang nanti diganti pembacaan dari contract. Biaya admin dari konfigurasi lingkar.

## 6. Idempotensi
- Checkout: `idempotency_key` = `circleId:periodId:memberId`. Panggilan ulang mengembalikan order yang sama (atau token yang sama selama masih PENDING).
- Webhook: `payload_hash` unik; duplikat dibalas 200 tanpa efek.
- Outbox: `chain_jobs.order_id` unik, satu pembayaran satu job.

## 7. Antarmuka ke jalur kontrak (outbox)
Satu baris `chain_jobs` per order SETTLED dengan payload minimal (tanpa data pribadi):
```json
{ "circleChainId": "...", "periodNo": 1, "memberRef": "m_ab12", "refHash": "0x...", "paidAt": 1700000000 }
```
Modul chain mengubah status job dan mengisi `chain_transactions`; backend memperbarui order ke ANCHORED/SETTLED_PENDING_CHAIN. `refHash` = Keccak-256 dari ringkasan transaksi gateway (tanpa data pribadi).

## 8. Pencairan (payout)
Sandbox: dimulai dengan simulasi (status disimpan di `payouts`, lalu panggil `markPayout` lewat modul chain). Spike Midtrans Iris (pembuat/penyetuju payout) dilakukan setelah webhook stabil; bila sandbox Iris tidak bisa dipakai, tetap simulasi dan batasannya dinyatakan di dokumentasi.

## 9. Keputusan yang diambil (bisa diubah)
- DB: PostgreSQL via Docker Compose, akses dengan `pg` dan SQL migrasi biasa (tanpa ORM) agar mudah dijelaskan saat presentasi.
- Validasi: zod. Tes: `node:test` bawaan Node + `tsx`.
- Auth: sesi sederhana (token) untuk sandbox; bukan fokus penilaian.

## Riwayat
- 2026-11-08: draf awal.
