# API v1 — LingkarPay (jalur payment gateway)

Base URL lokal: `http://localhost:3001`. JSON. Auth: header `Authorization: Bearer <token>` (token dari `/auth/register` atau `/auth/login`).
Error seragam: `{ "error": { "code": "...", "message": "...", "details"?: [...] } }`.
Uang dalam rupiah bulat (integer). Waktu dalam ISO 8601.

Kode error umum: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, konflik 409, `GATEWAY_*` 502.

## Auth
| | |
|---|---|
| `POST /auth/register` | Body `{ name, email, password(min 8) }` → 201 `{ user, token }`. 409 `EMAIL_TAKEN`. 429 `RATE_LIMITED` (header `Retry-After`) bila registrasi dari satu IP melewati `AUTH_REGISTER_MAX` per jendela waktu. |
| `POST /auth/login` | Body `{ email, password }` → `{ user, token }`. 401 `INVALID_CREDENTIALS`. 429 `RATE_LIMITED` (header `Retry-After`) setelah `AUTH_LOGIN_MAX_ATTEMPTS` kali gagal per IP + email dalam `AUTH_RATE_WINDOW_MINUTES` menit; login berhasil mereset hitungan. |
| `GET /auth/me` | → `{ user }`. `user` memuat `role` (`user` atau `admin`), dibaca dari database; frontend tidak menentukannya. |

## Admin platform
| | |
|---|---|
| `GET /admin/circles` | Hanya `role = admin` (403 bagi yang lain, 401 tanpa login). → `{ circles: [...] }` semua kelompok, ditambah `creatorName` (tanpa email). Dipakai konsol Operator. |

Peran `admin` diberikan di server: `npm run admin:grant -- email@contoh.id` (tambah `--revoke` untuk mencabut). Pendaftaran selalu menghasilkan `user`, apa pun emailnya. Admin boleh membuka laporan rekonsiliasi kelompok mana pun, tetapi tidak otomatis boleh mencairkan atau memberi suara (itu tetap hak pembuat kelompok dan anggota).

## Kelompok (circles)
| | |
|---|---|
| `POST /circles` | Body `{ name, contributionAmount(>=1000), memberCount(2-50), periodDays, penaltyPct(0-100)=0, startDate:"YYYY-MM-DD", payoutAccount:{ channel, accountNumber, accountName } }` → 201 kelompok + `myMemberId`. Pembuat otomatis menjadi anggota dengan rekening pencairan itu (wajib). **Biaya admin tidak diterima dari klien**: selalu `DEFAULT_ADMIN_FEE` (nilai `adminFee` yang dikirim diabaikan). Penalti = persentase iuran, dikenakan sekali bila membayar lewat tenggat. `startDate` (WIB) wajib: tidak boleh sebelum hari ini (400 `INVALID_START_DATE`); paling lambat satu tahun ke depan. 409 `HAS_OPEN_ARREARS` bila pembuat masih punya tunggakan yang belum lunas di kelompok mana pun. Status `draft`. |
| `GET /circles` | Kelompok milikku → `{ circles: [{..., joinedCount}] }` |
| `GET /circles/:id` | Detail: `circle`, `myMemberId`, `isCreator`, `members[{memberId, memberRef, name, turnOrder, isMe, hasPayoutAccount, payoutAccount, currentPayment{status, paid, penaltyDue}}]` (`payoutAccount` = rekening pencairan tersamar `{channel, channelLabel, kind, last4, accountName}`, hanya terlihat oleh pemiliknya dan pembuat kelompok; anggota lain hanya melihat `hasPayoutAccount`), `periods`, `currentPeriod`. Hanya anggota. |
| `GET /public/circles/:id` | **Tanpa login**, untuk portal verifikasi. Memuat `circle`, `members[{memberId, memberRef, turnOrder, currentPayment{status, paid}}]` (hanya pseudonim, tanpa nama atau email), `periods`, `currentPeriod`. Data dari database backend, bukan dari contract. |
| `POST /circles/:id/members` | **Mengundang** (bukan langsung menambah). Body `{ email }` (pengguna harus sudah terdaftar). Hanya pembuat, hanya saat `draft`. → 201 `{ memberId, memberRef, name, status:"invited" }`. Undangan ikut mengisi kursi. 409 `CIRCLE_FULL`, `ALREADY_MEMBER` (sudah anggota atau sudah diundang), `CIRCLE_STARTED`. |
| `GET /invitations` | Undangan saya yang menunggu jawaban → `{ invitations:[{ circle, memberId, creatorName, invitedAt }] }`. |
| `POST /circles/:id/invitation/accept` | Menerima undangan. Body `{ payoutAccount:{ channel, accountNumber, accountName } }` (**wajib**: rekening pencairan diisi saat bergabung). → `{ circleId, memberId, status:"active" }`. 404 bila tidak ada undangan. 409 `HAS_OPEN_ARREARS` bila masih punya tunggakan yang belum lunas (sanksi: tidak bisa bergabung ke kelompok baru sampai lunas). |
| `POST /circles/:id/invitation/decline` | Menolak undangan; kursi kosong lagi dan bisa diundang ulang. |
| `DELETE /circles/:id/invitations/:memberId` | Pembuat membatalkan undangan yang belum dijawab. |
| `DELETE /circles/:id/members/:memberId` | Pembuat mengeluarkan anggota aktif kelompok draft yang belum memulai/menyetor jaminan. 409 `MEMBER_HAS_DEPOSIT` (sudah menyetor: batalkan kelompok agar jaminan kembali), `CANNOT_REMOVE_SELF`. |
| `POST /circles/:id/cancel` | Pembuat membatalkan kelompok draft: undangan gugur, status `cancelled`, semua jaminan yang sudah disetor dikembalikan (transfer simulasi). → `{ circleId, status:"cancelled", depositsRefunded }`. 409 `CIRCLE_STARTED`. |
| `POST /circles/:id/start` | Tanpa body (urutan kiriman klien diabaikan). Hanya pembuat, pada atau sesudah `startDate` (WIB). **Urutan giliran diundi server**: seed acak 32 byte, anggota diurutkan menurut `SHA-256(seed:memberRef)`; seed disimpan dan dibuka di `circle.drawSeed` agar siapa pun bisa menghitung ulang. Mengunci urutan dan parameter, membuat semua periode (periode 1 `running`, tenggat = mulai + `periodDays`). 409 `CIRCLE_NOT_FULL`, `INVITES_PENDING` (masih ada undangan yang belum dijawab), `START_DATE_NOT_REACHED`, `DEPOSITS_PENDING` (ada anggota yang belum menyetor dana jaminan; pesan menyebut namanya). |
| `PUT /circles/:id/payout-account` | Anggota mengisi atau mengganti rekening pencairannya sendiri (data dummy). Body `{ channel, accountNumber, accountName }`; `channel`: `BCA`, `BNI`, `BRI`, `MANDIRI`, `BSI`, `CIMB`, `PERMATA` (bank, 6-20 digit) atau `GOPAY`, `OVO`, `DANA`, `SHOPEEPAY` (e-wallet, nomor ponsel `08...`). → `{ payoutAccount }`. Server hanya menyimpan 4 digit terakhir dan hash Keccak-256 `kanal:nomor`; nomor lengkap tidak disimpan. 400 `INVALID_ACCOUNT_NUMBER`, 403 bila bukan anggota. |
| `GET /circles/:id/periods` | → `{ periods: [{ id, periodNo, dueDate, status, recipientMemberId }] }` |
| `GET /circles/:id/payments` | → `{ payments: [...], payouts: [...] }`. Tiap pembayaran memuat `status`, rincian jumlah, `chainStatus`, `txHash`. Terbuka bagi semua anggota. Tiap `payouts[]` memuat rincian pencairan: `recipientName`, `recipientMemberRef`, `amount`, `mode`, `status`, `irisReferenceNo`, `recipientAccountHash` (hanya hash; nomor rekening tidak disimpan), tujuan transfer `destination` (rekening tersamar yang disalin saat pencairan, sehingga riwayat tidak berubah bila penerima mengganti rekening), `transferRef` (nomor referensi transfer: `SIM-TRF-...` untuk simulasi, nomor Iris untuk mode Iris), `transferredAt`, asal dana (`contributionTotal`, `penaltyTotal`, `adminFeeTotal` yang tidak ikut dicairkan, `paidCount`, `memberCount`, `contributors[]`), cara periode ditutup (`closedBy`: `quorum` atau `all_paid`, `approveVotes`, `quorumNeeded`, `closedAt`), serta status pencatatan chain (`chainStatus` = status job `markPayout`, `txHash`, `chainConfirmedAt`). |

## Checkout dan order
| | |
|---|---|
| `GET /public-config` | → `{ environment:"sandbox", midtransClientKey, snapJsUrl, adminFee }` untuk memuat Snap di frontend; `adminFee` = biaya admin per pembayaran yang ditetapkan aplikasi. |
| `POST /circles/:id/deposit/checkout` | Setoran **dana jaminan** oleh anggota sendiri, saat kelompok masih `draft`. Jumlah = `circle.depositAmount` (satu iuran + penalti), **tanpa biaya admin**. Respons sama dengan `/checkout`, idempoten. Setelah lunas: jaminan berstatus `held` (tidak dicatat ke contract). 409 `ALREADY_PAID`, `CIRCLE_STARTED`, `DEPOSIT_NOT_REQUIRED` (kelompok lama). |
| `POST /arrears/:id/checkout` | Pelunasan tunggakan oleh penunggaknya sendiri: tagihan iuran + penalti + biaya admin, respons sama dengan `/checkout`. 403 bukan penunggaknya, 409 `ARREAR_SETTLED`. |
| `POST /checkout` | Body `{ circleId, periodId, memberId }` (memberId harus milik user yang login). 201 order baru, 200 bila memakai ulang order PENDING. |
| `GET /orders/:orderId` | Detail order + `history`. Hanya pemilik order atau pembuat kelompok. `?sync=true` (saat PENDING) menanyakan Status API Midtrans lebih dulu. |
| `POST /orders/:orderId/cancel` | Batalkan order PENDING yang sudah punya transaksi di Midtrans (VA/e-wallet sudah dipilih). Order menjadi FAILED sehingga anggota bisa membayar lagi. 409 `NOT_CANCELLABLE` (bukan PENDING, atau Midtrans menolak), 409 `NO_GATEWAY_TRANSACTION` (metode bayar belum dipilih; tunggu kedaluwarsa). |
| `POST /orders/:orderId/expire` | Kedaluwarsakan order PENDING sekarang lewat Expire API Midtrans (hasil EXPIRED). Aturan dan kode error seperti cancel, dengan `NOT_EXPIRABLE`. |

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
| `POST /payouts/simulate` | Body `{ periodId }`. Periode harus `ready_payout`. → 201 `{ id, status:"SIMULATED", mode, amount, payoutRefHash, destination, transferRef, transferredAt }`. Boleh dipicu **pembuat kelompok atau penerima giliran periode itu**; anggota lain 403 `FORBIDDEN`. Tujuan transfer = rekening pencairan yang diisi penerima. Setelah periode selesai, periode berikutnya dibuka; bila dibuka terlambat, tenggatnya digeser menjadi sekarang + `periodDays` agar anggota tetap mendapat waktu penuh. 409 `PERIOD_NOT_READY`, `PAYOUT_EXISTS`, `PAYOUT_ACCOUNT_REQUIRED` (penerima belum mengisi rekening), `CHAIN_NOT_READY`, `CHAIN_ALREADY_PAID_OUT`, `CHAIN_RECIPIENT_MISMATCH`; 503 `CHAIN_UNAVAILABLE` (lihat gerbang contract di bawah). |
| `POST /payouts/iris` | Body `{ periodId, beneficiary:{ name, account, bank, email } }` (data dummy). Butuh `IRIS_ENABLED=true` + kunci. Status akhir `APPROVED`. 400 `IRIS_DISABLED`. |

Dana pencairan = iuran + penalti terkumpul; biaya admin tidak ikut.

**Gerbang contract sebelum pencairan.** Setelah pemeriksaan database lolos, backend membaca contract (`getCircle`, `getPeriod`, `recipientOf`). Pencairan hanya berjalan bila contract juga menyatakan periode siap cair (`ReadyPayout`, atau `Running` dengan semua iuran tercatat) dan penerima menurut jadwal contract sama dengan penerima di server. Bila belum, respons 409 `CHAIN_NOT_READY` (tunggu worker chain mencatat pembayaran atau usulan kuorum, lalu coba lagi) dan tidak ada payout yang tercatat. Diatur `PAYOUT_CHAIN_CHECK`: `auto` (bawaan; aktif bila `CHAIN_RPC_URL` dan `LINGKARPAY_ADDRESS` diisi), `on` (wajib; 503 `CHAIN_UNAVAILABLE` bila contract tidak terbaca), `off`.

## Dana jaminan
Setiap kelompok baru punya `circle.depositAmount` = iuran + penalti keterlambatan (cukup menutup satu tunggakan). Semua anggota, termasuk pembuat, menyetornya sebelum kelompok dikunci (`DEPOSITS_PENDING`). `GET /circles/:id` memuat `deposits[{ memberId, status:"held"|"refunded", amount, usedAmount, paidAt, refund{ amount, destination, transferRef, refundedAt } }]`; riwayat `GET /circles/:id/payments` menandai setoran dengan `isDeposit: true` dan `periodNo: null`.
- **Dipakai** hanya bila tunggakan tidak bisa lagi dipotong dari jatah: giliran penunggak sudah dicairkan (anggota yang berhenti bayar setelah menerima), atau kelompok selesai dengan tunggakan terbuka. Tunggakan berstatus `covered` dan diteruskan ke kreditor seperti pelunasan lain.
- **Dikembalikan**: sisa jaminan ditransfer (simulasi) ke rekening pencairan anggota saat kelompok selesai atau dibatalkan, ref `SIM-TRF-YYYYMMDD-J<circleId>-<memberId>`.
- Rekonsiliasi memuat `deposits{ count, heldTotal, usedTotal, refundedTotal, issues }`; terpakai + dikembalikan harus sama dengan yang disetor.

## Tunggakan (iuran tidak dibayar saat periode ditutup kuorum)
Saat kuorum menutup periode, setiap anggota yang belum membayar (kecuali penerima periode itu) tercatat menunggak satu iuran kepada penerima periode itu. Tunggakan muncul di `GET /circles/:id` sebagai `arrears[{ id, periodNo, debtorMemberId, debtorName, creditorMemberId, creditorName, amount, penaltyAmount, totalDue, status:"open"|"paid"|"deducted", settledPayoutPeriodNo, forward:{ amount, destination, transferRef, forwardedAt } }]` (terbuka untuk semua anggota) dan anggota detail memuat `status` (`invited`/`active`).
- **Dilunasi sendiri** lewat `POST /arrears/:id/checkout`. Pembayaran lama yang baru lunas setelah periode ditutup juga dianggap pelunasan. Pelunasan tidak dicatat ke contract (contract v2 hanya menerima pembayaran saat periode berjalan) dan tidak dihitung sebagai iuran periode itu; ditandai `isArrearsPayment` di riwayat pembayaran.
- **Dipotong dari jatah**: saat penunggak menerima giliran, tunggakan terbuka (iuran + penalti) dipotong dari jatahnya selama jatah bersih tetap lebih dari nol. Payout memuat `arrearsDeducted` dan `deductedArrears[]`; `amount` = jatah bersih.
- **Diteruskan ke kreditor**: setiap pelunasan dicatat sebagai transfer simulasi (iuran + penalti; biaya admin tetap pendapatan platform) ke rekening penerima periode itu, ref `SIM-TRF-YYYYMMDD-A<id>`.
- Rekonsiliasi: order pelunasan ditandai `ARREARS_PAYMENT` (informasi); `periods[].difference` = terkumpul − dicairkan − potongan tunggakan; `arrears` merangkum jumlah terbuka/lunas/dipotong dan yang belum diteruskan (dihitung sebagai masalah).

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

## Kuorum (usulan tutup periode)
Keputusan operasional untuk periode yang iurannya belum lengkap. Hanya anggota kelompok. Aturan: mayoritas mutlak (`anggota / 2 + 1`), satu anggota satu suara, batas voting 3 hari (sama dengan contract).

| | |
|---|---|
| `POST /periods/:periodId/close-proposals` | Tanpa body. Periode harus `running` dan iuran belum lengkap. → 201 usulan. 403 `FORBIDDEN` (bukan anggota), 409 `PERIOD_NOT_OPEN`, `NOT_DUE_YET` (periode belum lewat jatuh tempo; anggota masih punya waktu membayar), `NO_FUNDS` (belum ada satu pun iuran masuk), `PERIOD_COMPLETE`, `PROPOSAL_EXISTS` (sudah ada usulan terbuka untuk periode itu) |
| `GET /circles/:id/proposals` | → `{ proposals: [...] }` |
| `GET /proposals/:id` | → usulan |
| `POST /proposals/:id/votes` | Body `{ approve: true/false }`. → 201 usulan terbaru. 403 `FORBIDDEN`, 409 `ALREADY_VOTED`, `PROPOSAL_NOT_OPEN`, `VOTING_CLOSED` |

Bentuk usulan: `{ id, circleId, periodId, periodNo, kind:"close_period", status, deadline, approvals, rejections, quorum, myVote, chainProposalId }`. `status`: `open`, `rejected` (kuorum mustahil tercapai), `expired` (lewat batas waktu atau semua iuran akhirnya lunas), `executed` (disetujui kuorum). Saat disetujui, periode langsung `ready_payout` (pencairan lewat `/payouts/simulate` dengan dana yang terkumpul) dan periode tidak menerima iuran baru. `chainProposalId` bernilai `null` sampai usulan tercatat di chain.

## Lainnya
`GET /health` → `{ ok: true }`. Pada `DEV_TOOLS=true`: `GET /` (halaman tes Snap) dan `POST /dev/checkout` (transaksi tes tanpa database, order_id `TEST-...`), `POST /dev/circles/:id/deposit/simulate` (jaminan anggota yang login dianggap disetor tanpa Midtrans, `payment_type=dev_simulated`, dipakai skrip smoke), serta `POST /dev/periods/:id/make-overdue` (anggota kelompok; periode `running` dianggap sudah lewat jatuh tempo, untuk demo kuorum tanpa menunggu). Rute dev tidak terdaftar bila `NODE_ENV=production` dan tidak dihitung dalam 37 endpoint. `GET /public-config` memuat `devTools: true` saat rute ini aktif, sehingga UI menampilkan tombol simulasi.
`circle.chainCircleId` pada detail kelompok bernilai `null` sampai kelompok dicatat di chain (job `createCircle` selesai).
