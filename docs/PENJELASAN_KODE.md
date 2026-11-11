# Panduan Menjelaskan Kode — Jalur Payment Gateway

Untuk persiapan progress report dan presentasi. Bacalah berurutan: gambaran besar, peta kode, tiap komponen, satu alur dari awal sampai akhir, lalu tanya-jawab. Angka di sini sudah dicek ke kode: sekitar 3.100 baris kode (`apps/api/src`), 1.100 baris tes, 24 endpoint, 11 tabel, 87 tes.

## 1. Gambaran besar

### Versi 30 detik
"LingkarPay adalah dompet arisan digital. Anggota membayar iuran lewat Midtrans (VA atau e-wallet). Bagian saya adalah backend yang menerima konfirmasi pembayaran dari Midtrans, memastikan konfirmasi itu asli dan tidak ganda, mengubah status iuran, lalu mengantre pencatatannya ke smart contract di Ethereum Sepolia. Uang tidak pernah masuk ke contract; contract hanya menegakkan aturan dan menjadi catatan yang bisa diperiksa semua anggota."

### Versi 3 menit
1. **Masalah:** arisan manual bergantung pada satu pengelola (dana disalahgunakan, iuran macet, catatan tidak transparan).
2. **Solusi:** pembayaran tetap lewat kanal yang sudah dikenal (Midtrans), aturan di smart contract.
3. **Peran backend:** jembatan antara dunia rupiah (Midtrans) dan dunia blockchain. Smart contract tidak bisa melihat dunia luar, jadi backend yang meneruskan kabar "iuran sudah dibayar" secara terpercaya.
4. **Tiga hal yang dijaga backend:** (a) keaslian: signature Midtrans diverifikasi; (b) ketepatan: tidak ada pembayaran ganda, status tidak bisa mundur, jumlah dicocokkan; (c) ketahanan: kalau blockchain gagal, pembayaran tetap sah dan pencatatan diulang.
5. **Bukti:** 87 tes otomatis, dua smoke test alur penuh, dan lima skenario di Midtrans sandbox sungguhan.

### Diagram alur
```
Anggota ──▶ Frontend ──POST /checkout──▶ API ──▶ Midtrans Snap (buat token)
   │                                      │
   └── bayar di simulator ─────────────▶ Midtrans
                                          │ webhook (bertanda tangan)
                                          ▼
API: verifikasi signature → cek duplikat → cek jumlah → mesin status (PENDING → SETTLED)
   → tulis job ke outbox (chain_jobs) → periode "siap cair" bila semua lunas
                                          │
Modul chain (jalur smart contract) ◀──────┘ claimJobs
   → recordPayment ke Sepolia → markJobConfirmed → status ANCHORED
Operator → POST /payouts/simulate → pencairan dicatat → periode berikutnya dibuka
```

## 2. Peta kode (apps/api)

| Folder / file | Fungsi satu kalimat |
|---|---|
| `src/config.schema.ts`, `config.ts` | Membaca dan memvalidasi `.env` (gagal start bila ada yang kurang) |
| `src/server.ts`, `app.ts` | Menyalakan server Fastify, penanganan error seragam, parser JSON |
| `src/routes/*` | Lapisan HTTP tipis: validasi input, panggil service, kembalikan hasil |
| `src/services/*` | Seluruh logika bisnis (lihat bagian 3) |
| `src/lib/*` | Alat kecil: signature, hash, uang, HTTP klien, error, auth |
| `src/db/*`, `db/migrations/*` | Koneksi Postgres, transaksi, skema SQL |
| `src/chain/` | Tempat modul chain (jalur smart contract); kerangka saja |
| `src/**/*.test.ts`, `src/test/*` | 87 tes (unit dan integrasi) |
| `scripts/*.ps1` | Skrip uji alur penuh dan skenario di sandbox |

Aturan arsitektur yang bisa kamu sebut: **route tipis, logika di service, perubahan status hanya lewat satu modul**.

## 3. Komponen satu per satu

### 3.1 Konfigurasi (`config.schema.ts`)
- **Tujuan:** semua pengaturan (kunci Midtrans, database, batas waktu bayar, biaya admin) dibaca di satu tempat dan divalidasi dengan `zod`.
- **Cara kerja:** `parseConfig(env)` mengembalikan objek bertipe, atau melempar error yang hanya menyebut *nama* variabel, tidak pernah nilainya.
- **Poin menarik:** ada dua kunci Midtrans yang berbeda. *Server Key* untuk autentikasi API, *Signature Secret Key* (`MIDTRANS_SIGNATURE_KEY`) untuk memverifikasi signature. Ini ditemukan lewat uji nyata.
- **Bug yang pernah ditemukan:** pada zod 4, nilai bawaan boolean bisa menjadi string yang bernilai benar. Diperbaiki dan dites (`config.schema.test.ts`).

### 3.2 Server dan aplikasi (`app.ts`, `server.ts`)
- **Tujuan:** merakit server: daftar route, penanganan error, parser JSON.
- **Error seragam:** semua error berbentuk `{ error: { code, message } }`. `AppError` untuk error yang kita lempar sendiri, `ZodError` menjadi 400 `VALIDATION_ERROR`.
- **Parser JSON khusus:** body kosong dengan header JSON diterima sebagai `{}` (bawaan Fastify menolaknya), dan kunci `__proto__` dibuang.
- **`server.ts`:** menyalakan server, memaksa DNS memilih IPv4 dulu (di Windows sering timeout), menjalankan penyapu order kedaluwarsa tiap menit, dan mencatat sidik jari key (bukan key-nya) saat start.

### 3.3 Database (`db/migrations/001_init.sql`, `002_*.sql`, `db/pool.ts`)
- **11 tabel:** `users`, `sessions`, `circles`, `members`, `periods`, `orders`, `order_status_history`, `webhook_events`, `payouts`, `chain_jobs`, `chain_transactions`.
- **Keputusan penting:**
  - **Uang = BIGINT rupiah** (bilangan bulat), tidak pernah float, agar tidak ada selisih pembulatan.
  - **Satu iuran aktif per anggota per periode** dijaga oleh *indeks unik parsial* di database (`orders_one_active_per_member_period`), bukan hanya oleh kode. Walaupun ada bug atau permintaan serentak, database menolak order ganda.
  - **`member_ref`** (mis. `m_ab12cd34`) adalah ID samaran untuk blockchain: tidak ada nama, email, atau nomor rekening di chain (UU PDP).
  - **`CHECK gross_amount = amount + penalty_amount + admin_fee`** di tingkat tabel.
- **`withTx`** (`pool.ts`): membungkus beberapa query dalam satu transaksi (semua berhasil atau semua batal).
- **Migrasi 002:** menambah job `createCircle` ke outbox.

### 3.3b Akun (`services/auth.ts`, `lib/auth.ts`)
Daftar/login sederhana untuk sandbox: kata sandi di-hash `scrypt`, sesi berupa token acak yang hanya disimpan dalam bentuk hash SHA-256, masa berlaku 7 hari. Bukan fokus penilaian; cukup untuk membedakan pemilik dan pembuat kelompok.

### 3.4 Kelompok, anggota, periode (`services/circles.ts`, `periods.ts`)
- **Alur:** buat kelompok (status `draft`) → tambah anggota lewat email → `start`.
- **`startCircle`:** mengunci urutan giliran dan parameter, membuat semua periode (periode 1 langsung `running`, sisanya `scheduled`), dan **mengantre job `createCircle`** untuk blockchain. Semua dalam satu transaksi.
- **`refreshPeriodReadiness`:** begitu semua anggota punya iuran lunas, periode berubah ke `ready_payout`. Ini cermin dari sisi backend; keputusan resmi ada di contract.
- **Otorisasi:** hanya anggota yang boleh melihat; hanya pembuat yang boleh menambah anggota, memulai, mencairkan, dan melihat rekonsiliasi.

### 3.5 Tagihan (`services/billing.ts`)
- **Rumus:** `gross = iuran + penalti + biaya admin`.
- **Penalti:** bila lewat tenggat, `ceil(iuran × persen / 100)` dihitung dengan **aritmetika bilangan bulat** (tanpa float). Seragam untuk semua anggota.
- **Biaya admin** adalah pendapatan LingkarPay dan **tidak ikut dicairkan** ke penerima.
- **Batasan jujur:** penalti dan biaya admin di-*snapshot* saat order dibuat; order PENDING yang dipakai ulang tidak menghitung ulang penalti.
- **`billItems`:** rincian untuk Snap, selalu berjumlah sama dengan `gross` (dites).

### 3.6 Checkout (`services/checkout.ts`)
- **Tujuan:** membuat order `PENDING` dan token Snap untuk satu anggota di satu periode.
- **Idempoten:** panggilan ulang mengembalikan order dan token yang sama (Midtrans hanya dipanggil sekali). Iuran yang sudah lunas ditolak (`ALREADY_PAID`).
- **Penjagaan:** hanya pemilik `memberId` yang boleh membayar; kelompok harus `active`; periode harus `running`.
- **Order kedaluwarsa** otomatis ditutup (`EXPIRED`) dan diganti order baru.
- **Race condition yang diperbaiki:** dua checkout serentak bisa membuat satu menutup order yang belum sempat mendapat token. Sekarang yang kedua *menunggu* token (`waitForToken`) dan indeks unik di database menjadi pengaman terakhir. Ditemukan saat merancang tes.
- **Format `order_id`:** `LP-{kelompok}-{periode}-{anggota}-{waktu}` (maks. 50 karakter, syarat Midtrans).
- **Kanal bayar:** VA bank dan e-wallet saja (QRIS umum sengaja tidak diaktifkan di sandbox, sesuai peringatan tugas).

### 3.6b Klien Midtrans dan HTTP (`services/midtrans.ts`, `lib/http.ts`)
- **Tiga panggilan:** buat token Snap, baca status transaksi (Status API), batalkan/kedaluwarsakan transaksi.
- **`lib/http.ts`:** klien HTTPS sendiri dengan koneksi **dipaksa IPv4**, batas waktu 20 detik, dan **percobaan ulang**. GET diulang untuk error jaringan; POST hanya diulang bila koneksi belum terbentuk (agar tidak membuat transaksi ganda). Dibuat karena Node sempat timeout padahal PowerShell bisa terhubung.
- **`gatewayHttp`:** satu titik yang bisa diganti saat tes, sehingga tes tidak menyentuh jaringan.

### 3.7 Webhook (`services/webhook.ts`, `routes/webhook.ts`) — bagian paling penting
Urutan pemeriksaan, bisa kamu sebut sebagai "tujuh gerbang":
1. **Payload lengkap?** Kalau tidak: 400.
2. **Signature valid?** `SHA512(order_id + status_code + gross_amount + kunci)`, dibandingkan dengan `timingSafeEqual` (tahan serangan pengukuran waktu). Salah: **401**, dicatat.
3. **Duplikat?** Hash dari field kunci payload disimpan dengan indeks unik; notifikasi berulang dibalas 200 tanpa efek (`duplicate`). Dua notifikasi identik *serentak* pun hanya satu yang diterapkan.
4. **Order dikenal?** Tidak (mis. transaksi tes): 200 dan dicatat (`unknown_order`) agar Midtrans tidak mengirim ulang terus.
5. **Jumlah cocok?** `gross_amount` dari Midtrans harus sama dengan tagihan di database. Tidak: **400** dan status tidak berubah.
6. **Status dipetakan** (`settlement`→SETTLED, `deny/cancel/failure`→FAILED, `expire`→EXPIRED, lainnya diabaikan).
7. **Mesin status** menerapkan perubahan; hasilnya `applied`, `unchanged`, atau `ignored_transition`.
- **Penting:** `gross_amount` dipakai sebagai *string persis* untuk signature (`"11000.00"`, bukan `11000`).
- **Setiap kejadian dicatat** di `webhook_events` (bukti audit). Signature palsu tidak bisa memblokir notifikasi asli (hash-nya berbeda ruang).
- **Sumber kebenaran bayar** adalah webhook bertanda tangan (atau Status API), bukan halaman redirect di browser.

### 3.8 Mesin status pesanan (`services/orderStatus.ts`)
```
PENDING ─▶ SETTLED ─▶ ANCHORED          (tercatat di Sepolia)
   │          └─────▶ SETTLED_PENDING_CHAIN ─▶ ANCHORED   (blockchain gagal, diulang)
   ├──────▶ FAILED
   └──────▶ EXPIRED
```
- **Satu-satunya tempat status boleh berubah.** Baris order dikunci (`FOR UPDATE`) saat diubah sehingga dua notifikasi serentak tidak saling menimpa.
- **Status final** (`FAILED`, `EXPIRED`, `ANCHORED`) tidak bisa diubah. Pembayaran yang sudah sah (`SETTLED`+) tidak bisa diturunkan. Itu sebabnya notifikasi yang datang terlambat atau tidak berurutan tidak merusak data.
- Transisi tidak sah *diabaikan* (bukan error) dan dicatat; setiap perubahan masuk `order_status_history`.

### 3.9 Pemulihan lewat Status API (`services/gatewayStatus.ts`)
- **Tujuan:** kalau webhook hilang atau terlambat, backend bisa bertanya langsung ke Midtrans (`GET /orders/:id?sync=true`) dan menerapkan hasilnya lewat jalur yang sama dengan webhook.
- **Aman:** respons Status API juga diverifikasi signature-nya sebelum diterapkan, dan jumlahnya dicocokkan.
- Dipakai juga oleh skrip uji sebagai cadangan, dan oleh cancel/expire.

### 3.10 Outbox ke blockchain (`services/outbox.ts`)
- **Masalah yang dipecahkan:** pembayaran sah tidak boleh batal hanya karena blockchain sedang lambat. Maka backend tidak memanggil contract langsung, melainkan menulis "pekerjaan" ke tabel `chain_jobs` (pola *outbox*), dan modul chain mengerjakannya terpisah.
- **Tiga jenis job:** `createCircle` (saat kelompok dimulai), `recordPayment` (saat order SETTLED), `markPayout` (saat pencairan). Satu kejadian = satu job (indeks unik).
- **Fungsi untuk modul chain:** `claimJobs`, `markCircleCreated`, `markJobConfirmed`, `markJobFailed`, `requeueJob`.
- **`claimJobs`:** aman dijalankan paralel (`FOR UPDATE SKIP LOCKED`); mendahulukan `createCircle`; **menahan job pembayaran sampai kelompoknya on-chain**; mengambil ulang job yang macet lebih dari 5 menit.
- **Gagal:** diulang dengan jeda bertahap (5, 10, 20 detik, dan seterusnya, maks. 300) sampai 5 kali; order menjadi `SETTLED_PENDING_CHAIN`. Setelah itu `failed` dan operator bisa `requeueJob`.
- **Payload tanpa data pribadi:** hanya ID samaran dan hash. `refHash` = Keccak-256 dari ringkasan transaksi (bukti silang ke catatan gateway).

### 3.11 Pencairan (`services/payouts.ts`, `iris.ts`)
- **Syarat:** hanya pembuat kelompok, hanya saat periode `ready_payout`, dan hanya sekali per periode.
- **Dana pencairan = iuran + penalti terkumpul** (tanpa biaya admin).
- **Simulasi (bawaan):** mencatat pencairan, mengantre job `markPayout`, menutup periode, membuka periode berikutnya (atau menutup kelompok di periode terakhir).
- **Iris** (layanan payout Midtrans): kode klien sudah ada (creator membuat, approver menyetujui) tetapi **belum diuji** karena butuh akun sandbox khusus.

### 3.12 Rekonsiliasi (`services/reconciliation.ts`)
- **Tujuan:** mencocokkan tiga sumber: database, gateway, dan chain. Hanya untuk pembuat kelompok.
- **Hasil:** ringkasan keuangan (total dibayar, pendapatan biaya admin, dana untuk pencairan), perbandingan terkumpul vs dicairkan per periode (selisih harus 0), dan `flags` per order, misalnya `PAID_WITHOUT_CHAIN_JOB`, `ANCHORED_WITHOUT_TX`, `CHAIN_FAILED`. Mode `live=true` menambah pemeriksaan ke Status API.
- **`CHAIN_PENDING`** hanya informasi (menunggu pencatatan), bukan masalah.

### 3.13 Batalkan dan kedaluwarsakan (`services/orders.ts`)
`POST /orders/:id/cancel` dan `/expire` memanggil Cancel/Expire API Midtrans lalu menyinkronkan status (hasil `FAILED` atau `EXPIRED`) sehingga anggota bisa membayar lagi. Hanya untuk order yang sudah punya transaksi di Midtrans. Catatan: Expire API menandai sukses dengan kode 407, bukan 200; dan keduanya butuh izin Capability pada server key.

### 3.14 Tes (87 tes)
| Jenis | Isi | Bergantung pada |
|---|---|---|
| Unit (sekitar 30) | signature, uang, hash (vektor uji Keccak/SHA-256), mesin status (semua kombinasi transisi), penalti, tagihan, konfigurasi | Tidak ada |
| Integrasi (sekitar 57) | checkout, webhook, pencairan, outbox, rekonsiliasi, createCircle, pembatalan, parser JSON | Postgres, database terpisah `lingkarpay_test`; Midtrans diganti tiruan |
- Tes menolak berjalan bila nama database tidak berakhiran `_test` (agar data dev tidak terhapus) dan memakai key palsu.
- Skenario yang sulit diuji manual ada di sini: notifikasi duplikat *serentak*, notifikasi tidak berurutan, signature palsu, dua checkout serentak.

### 3.15 Skrip uji (`scripts/smoke.ps1`, `smoke-scenarios.ps1`)
Menjalankan alur nyata lewat API dan hanya meminta satu langkah manual (membayar di simulator). `smoke.ps1` (19 pemeriksaan), `-Both` (30, termasuk pencairan), serta skenario e-wallet, kedaluwarsa, dan dibatalkan.

### 3.16 Smart contract (`contracts/contracts/LingkarPay.sol`)
- **Peran:** aturan arisan dan catatan yang bisa diperiksa semua orang. **Tidak menyimpan uang**; rupiah tetap di gateway (arsitektur pilihan A).
- **Akses:** hanya `operator` (akun backend) yang boleh mencatat; membaca dan `applyPenalty` boleh siapa pun.
- **Fungsi:** `createCircle`, `addMember` (urutan giliran = urutan ditambahkan), `startCircle` (mengunci anggota dan parameter), `recordPayment` (satu iuran satu catatan, menandai terlambat), `applyPenalty` (mencatat denda terutang, sekali per anggota per periode, rumus sama dengan backend), `closePeriod`, `markPayout` (menutup periode sendiri, membuka periode berikutnya, menutup kelompok di periode terakhir).
- **Aturan yang ditegakkan dan dites (28 test):** non-operator ditolak, pencatatan ganda ditolak, parameter terkunci setelah mulai, penerima sesuai urutan terkunci, penutupan hanya bila semua lunas, denda seragam.
- **Data di chain:** hanya `memberId` (bytes32 dari ID samaran), hash referensi pembayaran (`refHash`), dan hash pencairan; tanpa data pribadi.

### 3.17 Worker chain (`apps/api/src/chain/worker.ts`)
- **Peran:** menjembatani outbox ke contract. Loop: `claimJobs` → kirim transaksi (satu per satu dari akun operator) → tunggu receipt → `markJobConfirmed` atau `markCircleCreated`; gagal → `markJobFailed` (diulang bertahap).
- **Satu job `createCircle`** menghasilkan beberapa transaksi: `createCircle`, `addMember` per anggota sesuai urutan giliran, lalu `startCircle`; id kelompok on-chain disimpan ke `circles.chain_circle_id`, yang membuka job pembayaran kelompok itu.
- **Konfigurasi** di `.env`: `CHAIN_NAME` (hardhat atau sepolia), RPC, akun operator, alamat contract.

## 4. Satu alur dari awal sampai akhir (untuk didemokan)
| # | Kejadian | Kode yang bekerja | Hasil yang terlihat |
|---|---|---|---|
| 1 | Buat kelompok, tambah anggota, mulai | `circles.ts` | Periode 1 `running`; job `createCircle` `queued` |
| 2 | Anggota klik bayar | `checkout.ts`, `midtrans.ts` | Order `PENDING`, token Snap, tagihan Rp11.000 |
| 3 | Bayar di simulator | (Midtrans) | VA terbayar |
| 4 | Midtrans mengirim webhook | `webhook.ts`, `signature.ts` | Log `webhook diproses ... applied` |
| 5 | Status berubah | `orderStatus.ts` | `PENDING → SETTLED`, riwayat tercatat |
| 6 | Pekerjaan antre | `outbox.ts` | Job `recordPayment` `queued` |
| 7 | Semua anggota lunas | `periods.ts` | Periode `ready_payout` |
| 8 | Operator mencairkan | `payouts.ts` | Rp20.000 (tanpa biaya admin), periode 2 dibuka |
| 9 | Rekonsiliasi | `reconciliation.ts` | Selisih 0, `issues=0` |
| 10 | Worker mencatat ke Sepolia | `worker.ts`: `claimJobs` → contract → `markJobConfirmed` | `ANCHORED`; hash transaksi di Etherscan (`BUKTI_SEPOLIA.md`) |

## 5. Keputusan desain dan alasannya
| Keputusan | Alasan |
|---|---|
| Dana ditahan pihak berizin, contract hanya aturan dan audit (pilihan A) | LingkarPay tidak berposisi sebagai penghimpun/penyalur dana; rupiah harus lewat penyelenggara berizin |
| Status dari webhook, bukan redirect | Redirect hanya tampilan di browser dan bisa dipalsukan |
| Outbox, bukan memanggil contract langsung | Kegagalan blockchain tidak boleh membatalkan pembayaran sah; pencatatan diulang terpisah |
| Satu mesin status | Notifikasi bisa berulang atau tidak berurutan; status final tidak boleh mundur |
| Aturan integritas di database (indeks unik, CHECK) | Pengaman terakhir bila kode ada bug atau ada permintaan serentak |
| Uang BIGINT rupiah | Tanpa selisih pembulatan |
| Postgres + SQL biasa, tanpa ORM | Mudah dijelaskan dan diperiksa |
| `member_ref` samaran di chain | Data pribadi tidak boleh di blockchain (hak koreksi/hapus UU PDP) |
| Biaya admin tidak dicairkan | Itu pendapatan LingkarPay |

## 6. Tanya-jawab yang mungkin muncul
| Pertanyaan | Jawaban singkat |
|---|---|
| Apakah Midtrans bisa terhubung ke Ethereum? | Tidak langsung. Midtrans mengirim webhook HTTP ke backend; backend memverifikasi, lalu mencatat ke contract lewat modul chain. Backend adalah jembatan dan titik kepercayaan di sisi penghubung (oracle problem, diakui di proposal Bab II.D). |
| Kenapa tidak simpan uang di smart contract? (saran dosen) | Rupiah wajib lewat penyelenggara berizin; contract tidak bisa memegang rupiah. Desentralisasi itu spektrum: gateway tetap pintu masuk/keluar rupiah, sedangkan aturan, audit, dan penentuan penerima ada di contract. Menyimpan dana di contract hanya layak untuk prototipe dengan token uji. |
| Bagaimana kalau backend curang? | Backend tidak bisa mengubah aturan, memilih penerima, atau mencatat ganda (dicegah contract). Yang masih bisa: mencatat pembayaran yang tidak terjadi. Mitigasi: `refHash` memungkinkan audit silang ke catatan gateway, semua pencatatan terlihat lewat event, dan wewenang bisa dibagi (multisig) di pengembangan lanjutan. |
| Bagaimana kalau blockchain gagal? | Pembayaran tetap `SETTLED`. Pencatatan diulang bertahap sampai 5 kali; status `SETTLED_PENDING_CHAIN`; operator bisa antre ulang. |
| Bagaimana mencegah pembayaran dan notifikasi ganda? | Indeks unik di database, checkout idempoten, hash payload unik, satu pembayaran satu job. Dites, termasuk kasus serentak. |
| Bagaimana tahu notifikasi benar-benar dari Midtrans? | Signature SHA-512 dari order, kode status, jumlah, dan kunci rahasia; dibandingkan tahan-waktu. Palsu: 401 dan dicatat. |
| Biaya gas per transaksi on-chain? | Di Sepolia memakai ETH uji (tanpa biaya riil). Produksi dihitung di business case; mitigasi: pencatatan batch atau layer dua. |
| Ada biaya admin dan dana minimal? | Biaya admin sudah ada di tagihan (prototipe Rp1.000, asumsi) dan tidak ikut dicairkan. Iuran minimum di API Rp1.000; angka akhir ditetapkan di business case. |
| Mengapa memakai e-wallet lewat "qris"? | Midtrans melaporkan GoPay lewat QR sebagai `payment_type=qris`. Diuji hanya lewat simulator Midtrans, bukan aplikasi sungguhan. |
| Berapa yang sudah teruji? | 87 tes otomatis, smoke test alur penuh (30 pemeriksaan), dan skenario sandbox: sukses VA, sukses e-wallet, kedaluwarsa, dibatalkan. |
| Apa peran AI? | Lihat `docs/AI_STATEMENT.md`: AI membantu merancang dan menulis draf; semua dijalankan dan diverifikasi sendiri; kesalahan AI yang ditemukan dicatat. |

## 7. Jujur soal batasan (jangan diklaim lebih)
- **Contract dan worker sudah terbukti di Sepolia** (`docs/BUKTI_SEPOLIA.md`), tetapi kuorum (`propose`/`vote`) belum dikerjakan, dan worker belum idempoten untuk `createCircle` bila mati di tengah jalan.
- **Iris belum diuji** (butuh akun sandbox khusus). Pencairan memakai simulasi.
- **Penalti keterlambatan** terbukti di tes otomatis, belum di transaksi sandbox sungguhan.
- **Penalti di-snapshot** saat order dibuat (batasan yang diketahui).
- **Rekonsiliasi `live=true`** belum dicoba.
- **Autentikasi** sengaja sederhana (sandbox).

## 8. Istilah
| Istilah | Arti singkat |
|---|---|
| Webhook | Panggilan HTTP otomatis dari Midtrans ke backend saat status transaksi berubah |
| Signature | Tanda tangan hash yang membuktikan notifikasi asli |
| Idempoten | Diulang berapa kali pun hasilnya sama (tidak ganda) |
| Outbox | Tabel "pekerjaan menunggu" agar kegagalan pihak lain tidak membatalkan transaksi utama |
| Snap | Halaman pembayaran siap pakai dari Midtrans |
| VA | Virtual Account, nomor rekening sementara untuk satu tagihan |
| Sandbox / testnet | Lingkungan uji tanpa uang atau token bernilai |
| Anchoring (ANCHORED) | Tercatat di blockchain |
| Oracle problem | Smart contract tidak bisa melihat dunia luar, jadi butuh pihak yang melaporkan |
