# Rancangan Jalur Payment Gateway — Antarmuka v1

Dokumen ini adalah kontrak untuk jalur lain: frontend memakai API ini, jalur smart contract memakai outbox (§7). Detail endpoint ada di `API.md`, skema tabel di `ERD.md`. Perubahan setelah disepakati dicatat di Riwayat.

## 1. Alur
```
Frontend → POST /checkout → [order PENDING + token Snap] → anggota bayar di simulator
Midtrans → POST /midtrans-webhook → verifikasi signature → dedupe → cek jumlah
        → mesin status: order SETTLED → tulis chain_jobs (outbox) → periode siap cair bila semua lunas
Modul chain → claimJobs → recordPayment ke Sepolia → markJobConfirmed → order ANCHORED
Operator → POST /payouts/simulate → payout dicatat → job markPayout → periode berikutnya dibuka
Rekonsiliasi: GET /reports/reconciliation (orders ↔ gateway ↔ chain)
```

## 2. Status pesanan
| Status | Arti |
|---|---|
| PENDING | Order dibuat, token Snap terbit, belum dibayar |
| SETTLED | Webhook valid: pembayaran sukses |
| SETTLED_PENDING_CHAIN | Sudah dibayar, pencatatan on-chain gagal dan sedang diulang |
| ANCHORED | Tercatat di Sepolia (tx terkonfirmasi) |
| FAILED | Ditolak/dibatalkan gateway, atau gagal membuat token |
| EXPIRED | Lewat batas waktu bayar |

Transisi sah: PENDING → SETTLED \| FAILED \| EXPIRED; SETTLED → ANCHORED \| SETTLED_PENDING_CHAIN; SETTLED_PENDING_CHAIN → ANCHORED. FAILED, EXPIRED, ANCHORED final. Semua perubahan lewat `services/orderStatus.ts` dan tercatat di `order_status_history`. Transisi tidak sah (mis. notifikasi lama setelah status final) diabaikan, bukan menimbulkan error.

Pemetaan `transaction_status` Midtrans: `settlement` (dan `capture` selain `fraud_status=challenge`) → SETTLED; `pending` → PENDING; `deny`/`cancel`/`failure` → FAILED; `expire` → EXPIRED; lainnya (refund, authorize, dst.) diabaikan.

Status periode: `scheduled` → `running` → `ready_payout` → `done`. Periode menjadi `ready_payout` bila semua anggota punya iuran lunas (cermin sisi backend; keputusan resmi di contract `closePeriod`).

## 3. Skema database
Lihat `ERD.md` dan `apps/api/db/migrations/001_init.sql`. Ringkas:
`users`, `sessions`, `circles`, `members` (punya `member_ref` samaran), `periods`, `orders`, `order_status_history`, `webhook_events`, `payouts`, `chain_jobs` (outbox), `chain_transactions`.
Uang: BIGINT rupiah. Satu iuran aktif per anggota per periode dijaga indeks unik parsial pada `orders`.

## 4. Endpoint v1
Ringkasan (rincian di `API.md`):

| Metode | Path | Auth |
|---|---|---|
| POST | `/auth/register`, `/auth/login`; GET `/auth/me` | — / ya |
| POST | `/circles`; GET `/circles`, `/circles/:id` | ya |
| POST | `/circles/:id/members`, `/circles/:id/start` | ya (pembuat) |
| GET | `/circles/:id/periods`, `/circles/:id/payments` | ya |
| POST | `/checkout` | ya |
| GET | `/orders/:orderId` (opsional `?sync=true`) | ya |
| POST | `/orders/:orderId/cancel` | ya (pemilik order / pembuat kelompok) |
| POST | `/orders/:orderId/expire` | ya (pemilik order / pembuat kelompok) |
| POST | `/midtrans-webhook` | signature Midtrans |
| GET | `/status/:orderId` | — (sandbox; baca Status API + cek signature) |
| POST | `/payouts/simulate`, `/payouts/iris` | ya (pembuat) |
| GET | `/reports/reconciliation` | ya (pembuat) |
| POST | `/periods/:periodId/close-proposals`; GET `/circles/:id/proposals`, `/proposals/:id`; POST `/proposals/:id/votes` | ya (anggota) |
| GET | `/public-config`, `/health` | — |

Format error seragam: `{ "error": { "code": "...", "message": "..." } }`.

## 5. Tagihan
`gross_amount = iuran + penalti terutang + biaya admin`.
- Penalti: bila lewat tenggat, `ceil(iuran × penalty_pct / 100)` (aritmetika bilangan bulat), seragam untuk semua anggota. Satu fungsi `computePenalty`; nanti dapat diganti pembacaan dari contract.
- Biaya admin: `circles.admin_fee` (bawaan `DEFAULT_ADMIN_FEE`). Ini pendapatan LingkarPay dan tidak ikut dicairkan.
- Penalti dan biaya admin di-**snapshot saat order dibuat**. Order PENDING yang dipakai ulang memakai angka lama sampai kedaluwarsa (batasan yang diketahui: penalti tidak dihitung ulang bila tenggat terlewati saat order masih berlaku).

## 6. Idempotensi
- Checkout: panggilan ulang mengembalikan order PENDING yang sama (token sama). Iuran lunas → 409 `ALREADY_PAID`. Dua checkout serentak ditangani indeks unik parsial.
- Webhook: `payload_hash` unik; notifikasi berulang dibalas 200 tanpa efek.
- Outbox: satu order SETTLED = satu job `recordPayment`; satu payout = satu job `markPayout`; satu usulan = satu job `proposeClosePeriod` dan satu job `executeProposal`; satu suara = satu job `castVote`.
- Kuorum: satu usulan terbuka per periode (indeks unik parsial) dan satu suara per anggota per usulan (UNIQUE).
- Chain: `createCircle` memakai `externalRef` (hash id kelompok) sehingga pembuatan kelompok idempoten.

## 7. Antarmuka ke jalur smart contract (outbox)
Modul chain TypeScript memakai fungsi di `src/services/outbox.ts` (satu proses/repo, tanpa HTTP). Ada enam jenis job:

| Job (`kind`) | Dibuat saat | Dicatat ke contract sebagai |
|---|---|---|
| `createCircle` | Kelompok dimulai (`POST /circles/:id/start`) | `createCircle` + `addMember` (urutan giliran) + `startCircle` |
| `recordPayment` | Order menjadi SETTLED | `recordPayment` |
| `markPayout` | Payout dibuat | `markPayout` |
| `proposeClosePeriod` | Usulan tutup periode dibuat | `proposeClosePeriod` |
| `castVote` | Anggota memberi suara | `vote` |
| `executeProposal` | Usulan disetujui kuorum | `executeProposal` |

| Fungsi | Kapan |
|---|---|
| `claimJobs(limit)` | Ambil job `queued` yang siap (aman paralel; job `sent` macet > 5 menit diambil ulang). Menaikkan `attempts`. `createCircle` didahulukan; job selain `createCircle` hanya diberikan bila kelompoknya sudah on-chain; `castVote`/`executeProposal` menunggu usulannya on-chain; `markPayout` menunggu semua job kuorum kelompoknya terkonfirmasi, dan `payload.circleChainId` diisi nilai terbaru. |
| `markCircleCreated(jobId, chainCircleId, txHash)` | Kelompok sudah dibuat di chain. Menyimpan `circles.chain_circle_id` (membuka job pembayaran kelompok itu). Idempoten. |
| `markProposalCreated(jobId, chainProposalId, txHash)` | Usulan sudah dibuat di chain. Menyimpan `proposals.chain_proposal_id` (membuka job suara dan eksekusi usulan itu). Idempoten. |
| `markJobConfirmed(jobId, txHash)` | Tx `recordPayment`/`markPayout` terkonfirmasi. Order `recordPayment` → ANCHORED. Idempoten. Menolak job `createCircle`. |
| `markJobFailed(jobId, error)` | Gagal kirim. Diulang dengan backoff sampai 5 kali; order → SETTLED_PENDING_CHAIN. |
| `requeueJob(jobId)` | Operator mengantrekan ulang job yang sudah `failed`. |

Payload job (tanpa data pribadi):
```json
// createCircle
{ "circleId": 1, "contributionAmount": 100000, "memberCount": 3, "periodDays": 7, "penaltyPct": 5,
  "members": [ { "memberRef": "m_ab12cd34", "turnOrder": 1 }, { "memberRef": "m_ef56ab78", "turnOrder": 2 } ] }
// recordPayment
{ "circleId": 1, "circleChainId": "42", "periodNo": 1, "memberRef": "m_ab12cd34",
  "refHash": "0x…", "paidAt": 1700000000 }
// markPayout
{ "circleId": 1, "circleChainId": "42", "periodNo": 1, "recipientMemberRef": "m_ab12cd34",
  "payoutRefHash": "0x…", "recipientAccountHash": null, "amount": 300000 }
// proposeClosePeriod
{ "circleId": 1, "circleChainId": "42", "proposalId": 7, "periodNo": 1 }
// castVote (chainProposalId diisi claimJobs dari proposals.chain_proposal_id)
{ "circleId": 1, "circleChainId": "42", "proposalId": 7, "chainProposalId": "3", "memberRef": "m_ab12cd34", "approve": true }
// executeProposal
{ "circleId": 1, "circleChainId": "42", "proposalId": 7, "chainProposalId": "3" }
```
`refHash` = Keccak-256 dari `lingkarpay:v1:{order_id}:{gateway_ref}:{gross_amount}` (bukan data pribadi). `circleChainId` adalah id kelompok di chain (string); bernilai `null` di job yang belum diambil dan selalu terisi pada job yang dikembalikan `claimJobs`.

Jaminan urutan: kelompok dibuat di chain lebih dulu; pembayaran yang masuk sebelum itu tetap SETTLED dan menunggu di antrean tanpa menghabiskan percobaan. Suara dan eksekusi menunggu usulannya on-chain, dan `markPayout` menunggu semua job kuorum kelompok itu terkonfirmasi (contract menolak pencairan periode yang belum lengkap dan belum ditutup kuorum).

Idempotensi chain: `createCircle` di contract menerima `externalRef` = `keccak256("lingkarpay:circle:<id database>")` dan menolak referensi ganda; worker yang mengulang pekerjaan melanjutkan dari state contract (`circleIdByRef`, `getMembers`, `getPayment`, `getPeriod`, `hasVoted`, `proposalOfPeriod`) tanpa membuat catatan ganda.

## 8. Pencairan (payout)
- Simulasi (bawaan): hanya operator (pembuat kelompok), hanya saat periode `ready_payout`. Dana = iuran + penalti terkumpul (tanpa biaya admin). Mencatat `payouts`, mengantrekan `markPayout`, menandai periode `done`, membuka periode berikutnya (atau menutup kelompok).
- Iris sandbox (opsional, `IRIS_ENABLED=true` + kunci creator & approver): membuat payout lalu approve. Data penerima dummy; nomor rekening tidak disimpan, hanya hash Keccak-256-nya. Bentuk request mengikuti dokumentasi Iris dan **belum diuji** di sandbox kelompok. Notifikasi status payout dari Iris belum ditangani; status berhenti di `APPROVED`.

## 9. Keputusan yang diambil (bisa diubah)
- DB: PostgreSQL via Docker Compose (port 5433), akses `pg` + SQL migrasi biasa (tanpa ORM).
- Validasi: zod. Auth: token sesi sederhana (scrypt + token acak berhash), cukup untuk sandbox.
- Kanal bayar: VA bank dan e-wallet saja; QRIS dimatikan.
- `/status/:orderId` sengaja tanpa auth untuk memudahkan uji spike di sandbox.

## 10. Kuorum (usulan tutup periode)
Keputusan operasional untuk periode yang iurannya belum lengkap, dengan aturan yang sama dengan contract (mayoritas mutlak, satu anggota satu suara, batas 3 hari).
- `POST /periods/:periodId/close-proposals`: anggota membuat usulan (periode harus `running` dan belum lengkap; satu usulan terbuka per periode). Mengantre job `proposeClosePeriod`.
- `POST /proposals/:id/votes` body `{ approve }`: satu suara per anggota; mengantre job `castVote`. Setuju >= kuorum: periode menjadi `ready_payout`, usulan `executed`, job `executeProposal` diantre. Penolak sudah terlalu banyak: usulan `rejected`. Lewat batas waktu: `expired` (`VOTING_CLOSED`).
- Bila semua iuran akhirnya lunas, usulan yang masih terbuka menjadi `expired`.
- Setelah disetujui, periode tidak menerima iuran baru (`PERIOD_NOT_OPEN`); pencairan memakai dana yang terkumpul. Pembayaran dari order yang dibuat sebelum penutupan dan baru lunas sesudahnya tidak bisa dicatat on-chain (contract menolak) dan muncul di rekonsiliasi.
- Mengganti anggota hanya ada di contract (belum di backend).

## Riwayat
- 2026-11-08: draf awal.
- 2026-11-08: disesuaikan dengan implementasi: tabel `users` memakai `email`/`password_hash` plus `sessions`; `circles.member_count`; `chain_jobs.kind` (recordPayment/markPayout) dan `chain_transactions.job_id`; `orders.expires_at`; indeks unik parsial; `idempotency_key` berformat `circle:period:member#percobaan`; endpoint tambahan (`/circles/:id/start`, `/payouts/iris`, `/public-config`, `/orders/:orderId`); antarmuka outbox berupa fungsi.
- 2026-11-08: outbox ditambah job `createCircle` dan fungsi `markCircleCreated` (migrasi 002, kolom `chain_jobs.circle_id`). `claimJobs` menahan job pembayaran/pencairan sampai kelompoknya on-chain dan mengisi `payload.circleChainId`. Rekonsiliasi memuat `chain` (status kelompok di chain).
- 2026-11-11: kuorum (usulan tutup periode): migrasi 003 (`proposals`, `proposal_votes`, kolom `chain_jobs.proposal_id` dan `vote_id`), tiga jenis job baru (`proposeClosePeriod`, `castVote`, `executeProposal`), `markProposalCreated`, gating `castVote`/`executeProposal`/`markPayout`. `createCircle` di contract memakai `externalRef` (idempotensi). Contract final ter-deploy di Sepolia (v2).
