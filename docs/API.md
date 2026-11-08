# API v1 — LingkarPay (jalur payment gateway)

Base URL lokal: `http://localhost:3001`. JSON. Auth: header `Authorization: Bearer <token>` (token dari `/auth/register` atau `/auth/login`).
Error seragam: `{ "error": { "code": "...", "message": "...", "details"?: [...] } }`.
Uang dalam rupiah bulat (integer). Waktu dalam ISO 8601.

Kode error umum: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, konflik 409, `GATEWAY_*` 502.

## Auth
| | |
|---|---|
| `POST /auth/register` | Body `{ name, email, password(min 8) }` → 201 `{ user, token }`. 409 `EMAIL_TAKEN`. |
| `POST /auth/login` | Body `{ email, password }` → `{ user, token }`. 401 `INVALID_CREDENTIALS`. |
| `GET /auth/me` | → `{ user }` |

## Kelompok (circles)
| | |
|---|---|
| `POST /circles` | Body `{ name, contributionAmount(>=1000), memberCount(2-50), periodDays, penaltyPct(0-100)=0, adminFee=DEFAULT_ADMIN_FEE }` → 201 kelompok + `myMemberId`. Pembuat otomatis menjadi anggota. Status `draft`. |
| `GET /circles` | Kelompok milikku → `{ circles: [{..., joinedCount}] }` |
| `GET /circles/:id` | Detail: `circle`, `myMemberId`, `isCreator`, `members[{memberId, memberRef, name, turnOrder, isMe, currentPayment{status, paid, penaltyDue}}]`, `periods`, `currentPeriod`. Hanya anggota. |
| `POST /circles/:id/members` | Body `{ email }` (pengguna harus sudah terdaftar). Hanya pembuat, hanya saat `draft`. 409 `CIRCLE_FULL`, `ALREADY_MEMBER`, `CIRCLE_STARTED`. |
| `POST /circles/:id/start` | Body `{ order?: [memberId,...] }` (urutan giliran; bawaan urutan bergabung). Mengunci urutan dan parameter, membuat semua periode (periode 1 `running`). 409 `CIRCLE_NOT_FULL`. 400 `INVALID_ORDER`. |
| `GET /circles/:id/periods` | → `{ periods: [{ id, periodNo, dueDate, status, recipientMemberId }] }` |
| `GET /circles/:id/payments` | → `{ payments: [...], payouts: [...] }`. Tiap pembayaran memuat `status`, rincian jumlah, `chainStatus`, `txHash`. Terbuka bagi semua anggota. |

## Checkout dan order
| | |
|---|---|
| `GET /public-config` | → `{ environment:"sandbox", midtransClientKey, snapJsUrl }` untuk memuat Snap di frontend. |
| `POST /checkout` | Body `{ circleId, periodId, memberId }` (memberId harus milik user yang login). 201 order baru, 200 bila memakai ulang order PENDING. |
| `GET /orders/:orderId` | Detail order + `history`. Hanya pemilik order atau pembuat kelompok. `?sync=true` (saat PENDING) menanyakan Status API Midtrans lebih dulu. |
| `POST /orders/:orderId/cancel` | Batalkan order PENDING yang sudah punya transaksi di Midtrans (VA/e-wallet sudah dipilih). Order menjadi FAILED sehingga anggota bisa membayar lagi. 409 `NOT_CANCELLABLE` (bukan PENDING, atau Midtrans menolak), 409 `NO_GATEWAY_TRANSACTION` (metode bayar belum dipilih; tunggu kedaluwarsa). |

Respons `POST /checkout`:
```json
{ "orderId": "LP-1-1-3-lq2x9k", "status": "PENDING", "token": "<snap token>",
  "amount": 100000, "penaltyAmount": 0, "adminFee": 1000, "grossAmount": 101000,
  "expiresAt": "2026-11-08T10:00:00.000Z", "reused": false }
```
Frontend: `snap.pay(token)`. Setelah itu polling `GET /orders/:orderId` sampai status `SETTLED`/`ANCHORED` (halaman redirect Midtrans hanya tampilan, bukan bukti bayar).

Error checkout: 403 `FORBIDDEN` (bukan anggota ybs), 409 `ALREADY_PAID`, `CIRCLE_NOT_ACTIVE`, `PERIOD_NOT_OPEN`, 502 `GATEWAY_ERROR`/`GATEWAY_UNREACHABLE`.

## Webhook
`POST /midtrans-webhook` — dipanggil Midtrans (bukan frontend). Balasan `{ ok, outcome }`.

| HTTP | outcome | Arti |
|---|---|---|
| 200 | `applied` / `unchanged` | Status diterapkan / sama |
| 200 | `duplicate` | Notifikasi berulang, diabaikan |
| 200 | `unknown_order` | order_id tak dikenal (mis. transaksi tes); dicatat |
| 200 | `ignored_transition` / `ignored_status` | Notifikasi lama atau jenis status yang tak mengubah apa pun |
| 400 | `amount_mismatch` | gross_amount tidak sama dengan tagihan; dicatat |
| 400 | `invalid_payload` | Payload tak lengkap |
| 401 | `invalid_signature` | Signature tidak cocok; dicatat |

Signature: `SHA512(order_id + status_code + gross_amount + ServerKey)`, `gross_amount` sebagai string persis dari payload.

## Status gateway
`GET /status/:orderId` — membaca Status API Midtrans dan memverifikasi signature responsnya (`signatureValid`). Tanpa auth (sandbox). 404 bila Midtrans tak mengenal order.

## Pencairan (operator = pembuat kelompok)
| | |
|---|---|
| `POST /payouts/simulate` | Body `{ periodId }`. Periode harus `ready_payout`. → 201 `{ id, status:"SIMULATED", mode, amount, payoutRefHash }`. 409 `PERIOD_NOT_READY`, `PAYOUT_EXISTS`. |
| `POST /payouts/iris` | Body `{ periodId, beneficiary:{ name, account, bank, email } }` (data dummy). Butuh `IRIS_ENABLED=true` + kunci. Status akhir `APPROVED`. 400 `IRIS_DISABLED`. |

Dana pencairan = iuran + penalti terkumpul; biaya admin tidak ikut.

## Rekonsiliasi
`GET /reports/reconciliation?circleId=1&live=true` — hanya pembuat kelompok. `live=true` menambah pemeriksaan ke Status API (maks. 50 order terbaru).
Memuat `summary` (jumlah per status, `grossPaid`, `adminFeeRevenue`, `collectedForPayout`, `payoutTotal`, `webhookEventsByOutcome`, `issues`), `periods` (terkumpul vs dicairkan, `difference` harus 0), `chain` (`chainCircleId` dan status job `createCircle`), dan `orders` dengan `flags`:

| Flag | Arti |
|---|---|
| `PAID_WITHOUT_CHAIN_JOB` | Lunas tapi tidak ada job on-chain |
| `ANCHORED_WITHOUT_TX` | ANCHORED tanpa tx_hash terkonfirmasi |
| `CHAIN_CONFIRMED_ORDER_NOT_ANCHORED` | Job terkonfirmasi tapi status order belum ANCHORED |
| `CHAIN_FAILED` | Job gagal permanen |
| `CHAIN_PENDING` | (info) menunggu pencatatan on-chain |
| `GATEWAY_PAID_DB_NOT`, `DB_PAID_GATEWAY_NOT`, `GATEWAY_CLOSED_DB_PENDING` | Status database berbeda dari gateway (live) |
| `GATEWAY_AMOUNT_MISMATCH`, `GATEWAY_NOT_FOUND`, `GATEWAY_SIGNATURE_INVALID`, `GATEWAY_CHECK_FAILED` | Masalah saat pemeriksaan live |

## Lainnya
`GET /health` → `{ ok: true }`. Pada `DEV_TOOLS=true`: `GET /` (halaman tes Snap) dan `POST /dev/checkout` (transaksi tes tanpa database, order_id `TEST-...`).
`circle.chainCircleId` pada detail kelompok bernilai `null` sampai kelompok dicatat di chain (job `createCircle` selesai).
