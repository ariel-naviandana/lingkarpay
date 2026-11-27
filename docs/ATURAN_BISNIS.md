# Aturan Bisnis dan Kondisi Aplikasi LingkarPay (per 28 November 2026)

Dokumen ini satu-satunya rujukan "aplikasi sekarang seperti apa" untuk penyusun **laporan dokumentasi teknis** dan **business case**. Isinya: peran, siklus kelompok, aturan uang, semua kode penolakan, fitur per halaman, angka yang bisa dipakai di business case, batasan, dan riwayat perubahan sejak commit `a648cbb`. Rincian teknis ada di `API.md` (endpoint), `ERD.md` (tabel), `KEAMANAN.md` (keamanan dan celah blockchain), dan `PENJELASAN_KODE.md` (kode).

Semua berjalan di sandbox: Midtrans sandbox, Ethereum Sepolia (testnet), data dummy. Tidak ada uang nyata.

## 1. Ringkasan satu paragraf
LingkarPay adalah arisan digital bergilir. Pembuat kelompok menetapkan iuran, jumlah anggota, periode, penalti, dan tanggal mulai; anggota bergabung lewat undangan dan mengisi rekening pencairan. Sebelum kelompok dikunci, setiap anggota menyetor **dana jaminan**. Saat dikunci, **urutan giliran diundi sistem** (bisa diperiksa ulang) dan aturan dicatat di **smart contract**. Tiap periode anggota membayar iuran lewat Midtrans (VA bank atau e-wallet); pembayaran dicatat ke contract. Bila semua lunas, dana dicairkan ke penerima giliran. Bila ada yang tidak membayar sampai lewat jatuh tempo, anggota memutuskan lewat **kuorum** untuk menutup periode dengan dana yang ada; yang tidak membayar menjadi **penunggak**, dan tunggakannya dilunasi sendiri, dipotong dari jatah gilirannya, atau ditutup dari jaminannya. Sisa jaminan dikembalikan saat kelompok selesai.

## 2. Peran
| Peran | Siapa | Boleh |
|---|---|---|
| Pengguna | Siapa pun yang mendaftar | Membuat kelompok, menerima atau menolak undangan |
| Pembuat kelompok (pengelola) | Pengguna yang membuat kelompok; otomatis anggota pertama | Mengundang, membatalkan undangan, mengeluarkan anggota draft yang belum menyetor jaminan, membatalkan kelompok draft, mengunci kelompok, mencairkan periode, melihat rekonsiliasi kelompoknya |
| Anggota | Pengguna yang menerima undangan | Menyetor jaminan, membayar iuran dan tunggakan, mengusulkan dan memberi suara kuorum, mengganti rekening pencairannya sendiri, melihat semua status kelompok |
| Penerima giliran | Anggota yang mendapat periode itu (hasil undian) | Mencairkan periodenya sendiri tanpa menunggu pengelola |
| Admin platform | Pengguna berperan `admin` di database (`npm run admin:grant -- email`) | Konsol operator: melihat semua kelompok dan rekonsiliasi kelompok mana pun. **Tidak** otomatis boleh mencairkan atau memberi suara |
| Publik | Tanpa akun | Portal verifikasi: status iuran dengan ID samaran, riwayat periode, dan pemeriksaan undian |

Pendaftaran selalu menghasilkan peran `user`; peran admin hanya diberikan dari server.

## 3. Siklus kelompok
```
draft ──(semua menerima undangan, semua menyetor jaminan, tanggal mulai tiba)──▶ active ──(periode terakhir dicairkan)──▶ completed
  └──(pembuat membatalkan)──▶ cancelled
```
Status periode: `scheduled` → `running` → `ready_payout` → `done`.

### 3.1 Membuat kelompok (draft)
| Aturan | Nilai |
|---|---|
| Iuran per periode | minimal Rp1.000 |
| Jumlah anggota | 2 sampai 50, termasuk pembuat |
| Periode setoran | UI: mingguan (7 hari) atau bulanan (30 hari); API: 1 sampai 365 hari |
| Penalti keterlambatan | 0 sampai 100% dari iuran, dikenakan **sekali** bila membayar lewat jatuh tempo, dibulatkan ke atas |
| Tanggal mulai | wajib; tidak boleh sebelum hari ini (WIB), paling lambat satu tahun ke depan |
| Biaya admin | **ditetapkan aplikasi** Rp1.000 per pembayaran (`DEFAULT_ADMIN_FEE`); pembuat tidak bisa mengubahnya |
| Dana jaminan per anggota | otomatis = iuran + penalti (contoh: iuran Rp10.000, penalti 5% → Rp10.500) |
| Rekening pencairan pembuat | wajib (pembuat juga mendapat giliran) |
| Kuorum | mayoritas mutlak: `floor(anggota/2) + 1` |
| Penunggak | tidak boleh membuat kelompok (`HAS_OPEN_ARREARS`) |

### 3.2 Mengisi anggota
- Pembuat mengundang **pengguna terdaftar** lewat email. Undangan ikut mengisi kursi (`CIRCLE_FULL` bila penuh).
- Yang diundang melihat undangan di dashboard, lalu **Terima** (wajib mengisi rekening pencairan) atau **Tolak** (kursi kosong lagi). Sebelum menerima, ia belum bisa melihat isi kelompok.
- Penunggak tidak boleh menerima undangan (`HAS_OPEN_ARREARS`).
- Pembuat bisa membatalkan undangan yang belum dijawab, dan mengeluarkan anggota yang belum menyetor jaminan (`MEMBER_HAS_DEPOSIT` bila sudah menyetor).
- Rekening pencairan: bank (BCA, BNI, BRI, Mandiri, BSI, CIMB, Permata) atau e-wallet (GoPay, OVO, DANA, ShopeePay). Server hanya menyimpan 4 digit terakhir, nama pemilik, dan hash Keccak-256 nomornya.

### 3.3 Dana jaminan
- Setiap anggota menyetor jaminan lewat Midtrans Snap, **tanpa biaya admin**, saat kelompok masih draft.
- Kelompok tidak bisa dikunci sebelum semua anggota menyetor (`DEPOSITS_PENDING`, pesan menyebut nama yang belum).
- Jaminan **tidak dipakai** selama tunggakan masih bisa dipotong dari jatah giliran penunggak. Jaminan dipakai bila:
  1. penunggak **sudah menerima gilirannya** lalu berhenti membayar (kasus klasik arisan), atau
  2. kelompok selesai dan masih ada tunggakan terbuka.
- Dana jaminan yang dipakai diteruskan ke penerima yang kurang (status tunggakan `covered`).
- Sisa jaminan **dikembalikan** ke rekening pencairan anggota saat kelompok selesai atau dibatalkan (transfer simulasi, ref `SIM-TRF-YYYYMMDD-J<kelompok>-<anggota>`).
- Jaminan dicatat di server, tidak di contract.

### 3.4 Mengunci kelompok (draft → active)
Hanya pembuat, dan hanya bila: jumlah anggota lengkap (`CIRCLE_NOT_FULL`), tidak ada undangan menggantung (`INVITES_PENDING`), semua jaminan disetor (`DEPOSITS_PENDING`), tanggal mulai sudah tiba (`START_DATE_NOT_REACHED`). Saat dikunci:
- **Undian urutan giliran:** server membuat seed acak 32 byte; anggota diurutkan menurut `SHA-256(seed:ID anggota)`. Pembuat tidak bisa memilih urutan (urutan yang dikirim klien diabaikan). Seed ditampilkan di halaman kelompok dan portal verifikasi, dan browser bisa menghitung ulang ("Cocok").
- Semua periode dibuat: jatuh tempo periode ke-n = waktu kunci + n × lama periode. Periode 1 langsung `running`.
- Kelompok, anggota (ID samaran), dan urutan giliran diantre untuk dicatat di contract Sepolia.

### 3.5 Membayar iuran
- Tagihan = iuran + penalti (bila sudah lewat jatuh tempo) + biaya admin. Contoh tepat waktu: Rp10.000 + Rp1.000 = Rp11.000; terlambat: + Rp500.
- Hanya anggota itu sendiri yang bisa membayar iurannya; satu iuran aktif per anggota per periode (dijaga indeks unik database).
- Kanal: VA bank dan e-wallet (QRIS umum sengaja dimatikan). Order berlaku 60 menit; checkout ulang memakai order yang sama.
- Status pembayaran hanya berubah dari webhook Midtrans bertanda tangan (atau Status API), bukan dari halaman redirect. Lalu dicatat ke contract: `PENDING → SETTLED → ANCHORED`.

### 3.6 Menutup periode
- **Normal:** begitu semua anggota lunas, periode menjadi siap cair (`ready_payout`), meskipun belum jatuh tempo.
- **Kuorum (darurat):** bila ada yang belum membayar, anggota bisa mengusulkan tutup periode dengan dana yang terkumpul, dengan syarat:
  - periode **sudah lewat jatuh tempo** (`NOT_DUE_YET`), agar anggota tidak dijadikan penunggak sebelum waktunya;
  - minimal satu iuran sudah masuk (`NO_FUNDS`), dan belum semua lunas (`PERIOD_COMPLETE`);
  - satu usulan terbuka per periode (`PROPOSAL_EXISTS`); batas voting 3 hari; satu anggota satu suara.
  - Disetujui bila setuju ≥ kuorum; ditolak bila kuorum mustahil tercapai; kedaluwarsa bila lewat 3 hari atau semua akhirnya lunas.
- Setelah ditutup, periode tidak menerima iuran baru (`PERIOD_NOT_OPEN`), dan anggota yang belum membayar (kecuali penerima periode itu) menjadi **penunggak** kepada penerima periode itu.

### 3.7 Pencairan
- Dipicu **pembuat atau penerima giliran** periode itu (anggota lain `FORBIDDEN`). Penerima harus sudah punya rekening (`PAYOUT_ACCOUNT_REQUIRED`).
- **Gerbang contract:** sebelum dana bergerak, server membaca contract; pencairan ditolak bila contract belum menyatakan periode siap cair (`CHAIN_NOT_READY`) atau penerimanya berbeda (`CHAIN_RECIPIENT_MISMATCH`).
- Dana dicairkan = iuran + penalti yang terkumpul periode itu − tunggakan penerima sendiri yang dipotong. **Biaya admin tidak ikut dicairkan** (pendapatan platform).
- Transfer simulasi ke rekening penerima dengan nomor referensi `SIM-TRF-YYYYMMDD-<kelompok>-<periode>`; hash pencairan dicatat ke contract.
- Periode berikutnya dibuka. Bila dibuka terlambat (pencairan tertunda), **jatuh temponya digeser** menjadi waktu buka + lama periode, supaya anggota tidak kena penalti padahal belum bisa membayar.
- Periode terakhir dicairkan → kelompok `completed` → tunggakan terbuka ditutup dari jaminan → sisa jaminan dikembalikan.

### 3.8 Tunggakan
| Cara lunas | Kapan | Status |
|---|---|---|
| Bayar susulan sendiri | Kapan saja; tagihan iuran + penalti + biaya admin | `paid` |
| Dipotong dari jatah | Saat penunggak menerima gilirannya | `deducted` |
| Ditutup dari jaminan | Giliran penunggak sudah lewat, atau kelompok selesai | `covered` |

Setiap pelunasan diteruskan ke penerima yang kurang (transfer simulasi, ref `SIM-TRF-YYYYMMDD-A<id>`). **Sanksi:** selama masih punya tunggakan terbuka di kelompok mana pun, pengguna tidak bisa membuat atau bergabung ke kelompok baru.

## 4. Alur uang (ringkas)
| Uang | Dari | Ke | Catatan |
|---|---|---|---|
| Jaminan | Anggota | Ditahan | Dikembalikan di akhir, atau menutup tunggakan |
| Iuran + penalti | Anggota | Penerima giliran | Lewat pencairan |
| Biaya admin | Anggota | LingkarPay | Per pembayaran iuran atau tunggakan; tidak untuk jaminan |
| Pelunasan tunggakan | Penunggak (atau jatah/jaminannya) | Penerima yang dulu kurang | Diteruskan otomatis |

Model hukum (proposal Bab V, arsitektur A): dana rupiah ditahan dan disalurkan pihak berizin (payment gateway); smart contract hanya menegakkan aturan dan menjadi catatan audit.

## 5. Fitur per halaman (frontend)
| Halaman | Isi |
|---|---|
| Masuk / daftar | Email dan kata sandi; batas percobaan login dan pendaftaran |
| Dashboard | Undangan (terima/tolak), tagihan aktif (iuran, tunggakan, jaminan yang belum disetor), kelompok saya, giliran berikutnya, aktivitas terbaru |
| Buat kelompok | 3 langkah: aturan (termasuk tanggal mulai), rekening dan undangan, tinjau. Menampilkan biaya admin dan jaminan |
| Detail kelompok | Anggota dan status iuran, jadwal periode, aturan kelompok (termasuk seed undian), pengaturan draft (undang, keluarkan, batalkan, kunci), dana jaminan, rekening pencairan saya, tunggakan, pencairan, riwayat pencairan, kuorum (dengan tombol simulasi jatuh tempo khusus sandbox) |
| Bayar iuran | Rincian tagihan dari server dan tombol Snap |
| Riwayat | Semua pembayaran (iuran, tunggakan, jaminan) dan status pencairan dengan rincian langkah |
| Konsol operator | Khusus admin: semua kelompok, rekonsiliasi, status job chain |
| Portal verifikasi | Publik: parameter, status iuran dengan ID samaran, riwayat periode, pemeriksaan undian, tautan Etherscan |

## 6. Angka untuk business case
| Item | Nilai di prototipe | Sumber |
|---|---|---|
| Biaya admin | Rp1.000 per pembayaran iuran/tunggakan (asumsi, ubah lewat `DEFAULT_ADMIN_FEE`) | `config.schema.ts` |
| Biaya admin jaminan | Rp0 | `checkout.ts` |
| Jaminan | 1 × iuran + penalti per anggota | `deposits.ts` |
| Penalti | % iuran, sekali, dibulatkan ke atas | `billing.ts` |
| Iuran minimum | Rp1.000 | `routes/circles.ts` |
| Anggota | 2–50 | `routes/circles.ts` |
| Masa berlaku order | 60 menit | `ORDER_EXPIRY_MINUTES` |
| Voting kuorum | 3 hari, mayoritas mutlak | `proposals.ts`, contract |
| Transaksi on-chain per kelompok | 1 `createCircle` + 1 per iuran + 1 per pencairan (+ usulan, suara, eksekusi bila kuorum) | `outbox.ts` |

Pendapatan per kelompok (contoh): 5 anggota × 5 periode = 25 iuran × Rp1.000 = Rp25.000, ditambah biaya admin pelunasan tunggakan bila ada. Biaya Midtrans (MDR per kanal) dan gas mainnet belum dihitung di kode; ambil dari tarif resmi.

Mitigasi risiko yang bisa disebut: jaminan (gagal bayar setelah menerima), potong jatah dan sanksi blokir (penunggak), kuorum hanya setelah jatuh tempo (penutupan sepihak), undian terverifikasi (kecurangan urutan oleh pengelola), pencairan oleh penerima (pengelola tidak aktif), gerbang contract (pencairan mendahului catatan on-chain), batas laju login (tebak kata sandi).

## 7. Batasan yang harus ditulis jujur
- Seed undian dibuat server: bisa diperiksa ulang, tetapi tetap mempercayai server. Lanjutan: Chainlink VRF di contract v3.
- Jaminan, tanggal mulai, dan tunggakan dicatat server, tidak di contract v2. Tenggat on-chain tidak ikut digeser.
- Jaminan menutup satu tunggakan per anggota; anggota yang menunggak berkali-kali setelah gilirannya tetap meninggalkan tunggakan (ditambah sanksi).
- Setoran jaminan di skrip uji disimulasikan (`/dev/circles/:id/deposit/simulate`); lewat UI memakai Snap sungguhan.
- Semua transfer keluar (pencairan, penerusan tunggakan, pengembalian jaminan) adalah simulasi; Iris (payout Midtrans) belum diuji.
- Operator (backend) dipercaya mencatat pembayaran dan meneruskan suara ke contract (oracle problem); mitigasinya `refHash` dan gerbang contract.
- Ganti anggota di tengah jalan hanya ada di contract, belum di aplikasi.
- Tidak ada notifikasi email/WhatsApp; pengingat hanya di dashboard.

## 8. Riwayat perubahan sejak commit `a648cbb`
| Commit | Tanggal | Isi |
|---|---|---|
| `a648cbb` | 24 Nov | Peran admin sungguhan (kolom `users.role`, migrasi 004, `npm run admin:grant`, `GET /admin/circles`, konsol operator khusus admin). Rincian pencairan (asal dana, kontributor, cara periode ditutup, status pencatatan chain) |
| `81964ab` | 27 Nov | Batas laju login/daftar dan header keamanan. Gerbang contract sebelum pencairan. Rekening pencairan anggota dan tujuan transfer simulasi (migrasi 005). Biaya admin ditetapkan aplikasi. Undangan terima/tolak dengan rekening wajib. Tunggakan: bayar susulan, potong jatah, diteruskan ke kreditor (migrasi 006). Tanggal mulai, undian giliran, kuorum hanya setelah jatuh tempo, tenggat digeser, pencairan oleh penerima, sanksi penunggak (migrasi 007). Perbaikan tampilan yang menyesatkan (penalti tiruan, status tunggakan, tombol bayar di header) |
| commit berikutnya | 28 Nov | Dana jaminan (migrasi 008), batalkan kelompok draft, keluarkan anggota draft, pemeriksaan undian di portal, Iris hanya oleh pembuat, dashboard (kelompok selesai/dibatalkan, tagihan tunggakan dan jaminan, aktivitas berurutan), halaman masuk tanpa kredensial contoh, kartu kuorum disembunyikan pada draft |

### Yang perlu diperbarui di laporan
- **Dokumentasi teknis:**
  - ERD: 15 tabel (baru: `arrears`, `deposits`; kolom baru di `users`, `circles`, `members`, `periods`, `orders`, `payouts`); lihat `ERD.md`.
  - API: 37 endpoint (tanpa rute dev); lihat `API.md` / `openapi.yaml`.
  - Migrasi 001–008; 151 tes backend (27 suite), 40 tes contract.
  - Diagram alur/aktivitas: tambahkan undangan, jaminan, undian, kuorum setelah jatuh tempo, tunggakan, pengembalian jaminan.
  - Use case/user story: tambahkan peran admin platform, penerima giliran, publik.
- **Business case:**
  - Model pendapatan: biaya admin per pembayaran, ditetapkan platform; jaminan bukan pendapatan.
  - Risiko dan mitigasi: bagian 6 di atas.
  - Proposisi nilai: undian adil yang bisa diperiksa, dana jaminan, penagihan tunggakan otomatis, transparansi on-chain.
  - Regulasi: jaminan dan iuran tetap dipegang pihak berizin (arsitektur A).
