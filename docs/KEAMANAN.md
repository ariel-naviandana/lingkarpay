# Model ancaman, celah blockchain, dan solusinya

Untuk presentasi dan tanya jawab. Dokumen ini jujur tentang batas prototipe: apa yang sudah diamankan, apa yang belum, dan solusi yang dapat dipasang. Status per 26 November 2026. Kolom "Butuh contract v3" berarti perubahan itu menuntut deploy ulang contract (alamat baru), sehingga tidak dikerjakan sebelum presentasi agar bukti di `docs/BUKTI_SEPOLIA.md` tetap berlaku.

## 1. Yang sudah diamankan

| Area | Kontrol | Bukti |
|---|---|---|
| Webhook Midtrans | Signature SHA-512 dibandingkan dengan waktu konstan, jumlah harus cocok, notifikasi ganda diabaikan, urutan terbalik tidak menurunkan status | Tes integrasi pembayaran |
| Checkout | Nominal dihitung server, idempoten, satu iuran aktif per anggota per periode | Tes integrasi pembayaran |
| Akun | Kata sandi scrypt, token sesi acak yang disimpan sebagai hash dan berbatas waktu, peran admin dari database | Tes admin |
| Batas laju (baru) | Login gagal dibatasi per IP + email, registrasi per IP; respons 429 dengan `Retry-After`. Atur lewat `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_REGISTER_MAX`, `AUTH_RATE_WINDOW_MINUTES` | `src/test/security.integration.test.ts`, `src/lib/rateLimit.test.ts` |
| Header keamanan (baru) | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP ketat, `Cache-Control: no-store` di semua respons | Tes keamanan |
| CORS | Sengaja tidak ada header CORS: frontend memanggil API lewat proxy Vite (asal yang sama), sehingga browser menolak panggilan dari situs lain | Tes keamanan |
| Tunggakan (baru) | Anggota yang tidak membayar saat periode ditutup kuorum tercatat menunggak; tunggakan dilunasi sendiri atau dipotong dari jatahnya saat giliran, lalu diteruskan ke penerima yang kurang. Mencegah penunggak menerima iuran penuh orang lain tanpa membayar | `src/test/arrears.integration.test.ts` |
| Undangan dan rekening (baru) | Anggota baru bergabung hanya dengan menerima undangan dan mengisi rekening; biaya admin ditetapkan aplikasi, bukan pembuat | `src/test/invitations.integration.test.ts` |
| Aturan bisnis (baru) | Urutan giliran diundi server (seed dibuka, bisa dihitung ulang), bukan dipilih pembuat; kelompok baru bisa dikunci pada tanggal mulai; usulan tutup periode hanya setelah jatuh tempo; tenggat periode yang dibuka terlambat digeser; pencairan oleh pembuat atau penerima; penunggak tidak bisa membuat atau bergabung ke kelompok baru sampai lunas | `src/test/rules.integration.test.ts` |
| Gerbang contract sebelum pencairan (baru) | Backend membaca status periode dan penerima langsung dari contract; pencairan ditolak (`CHAIN_NOT_READY`, `CHAIN_RECIPIENT_MISMATCH`) bila contract belum menyatakan siap cair atau penerimanya berbeda. Contract menjadi penentu sebelum dana bergerak | `src/test/chainGuard.integration.test.ts` |
| Contract | Semua fungsi tulis `onlyOperator` (kecuali `applyPenalty` yang hanya bisa setelah jatuh tempo), validasi status, tanpa catatan ganda, kuorum | 40 tes contract |
| Privasi on-chain | Hanya ID samaran (`m_xxxxxxxx`) dan hash; tanpa nama, email, atau rekening | `npm run inspect` |

Catatan aturan bisnis: seed undian dibuat server, jadi undian dapat diperiksa ulang tetapi tetap mempercayai server (versi lanjutan: Chainlink VRF atau blockhash di contract v3). Tenggat on-chain tetap `startTime + periodNo × periodDays`; bila periode dibuka terlambat, tenggat di aplikasi (dan penalti off-chain) bisa lebih longgar daripada tanda `late` di contract.

Catatan batas laju: hitungan disimpan di memori satu proses server. Di balik tunnel atau proxy, semua permintaan tampak dari satu IP, sehingga batas per IP + email yang paling berperan. Untuk beberapa instance server di produksi, hitungan dipindah ke penyimpanan bersama (misalnya Redis).

## 2. Celah blockchain dan solusinya

| # | Celah | Dampak | Solusi | Butuh contract v3 |
|---|---|---|---|---|
| B1 | Satu kunci operator menulis semua (deploy menjadikan `msg.sender` operator, tanpa fungsi ganti operator) | Kunci bocor berarti penyerang bisa mencatat pembayaran palsu, memberi suara, dan menandai pencairan | Operator diganti smart account multisig (Safe) atau peran terpisah; kunci worker disimpan di KMS/HSM | Ya (perlu fungsi ganti operator atau peran) |
| B2 | Suara kuorum dikirim operator atas nama anggota | Contract tidak bisa membuktikan anggota benar-benar setuju | Suara bertanda tangan anggota (EIP-712): anggota menandatangani dengan dompetnya, operator hanya meneruskan dan membayar gas, contract memeriksa tanda tangan dengan `ecrecover` | Ya (anggota perlu alamat dompet) |
| B3 | Fakta pembayaran masuk lewat backend (oracle problem) | Contract tidak bisa memeriksa Midtrans sendiri | Sudah ada `refHash` untuk audit silang, dan pencairan kini menunggu contract (gerbang di bagian 1), sehingga pencairan tidak bisa mendahului catatan on-chain. Lanjutan: oracle terdesentralisasi (Chainlink Functions) yang menanyakan Status API, atau tanda tangan ganda backend dan mitra berizin | Ya |
| B4 | Tidak ada pause atau upgrade | Bug memaksa deploy ulang tanpa rem darurat | `Pausable` dan `AccessControl` dari OpenZeppelin, dengan peran admin dipegang multisig | Ya |
| B5 | Portal verifikasi membaca database server | Publik tetap memercayai server untuk tampilan portal | Portal membaca contract langsung lewat RPC publik (viem) dan membandingkannya dengan data server | Tidak (perubahan frontend saja) |
| B6 | Belum ada audit pihak ketiga atau uji fuzz | Bug yang tidak terpikir di 40 tes bisa lolos | Analisis statis (Slither), tes invariant/fuzz, audit sebelum mainnet | Tidak |

### Rincian solusi

**B1. Multisig sebagai operator.** Safe adalah smart account yang butuh M dari N tanda tangan pemilik untuk menjalankan transaksi ([Safe docs](https://docs.safe.global/advanced/smart-account-overview)). Untuk LingkarPay: worker tetap memakai kunci sendiri untuk pencatatan harian dengan peran terbatas (`RECORDER`), sedangkan fungsi berisiko (ganti operator, pause) hanya bisa dijalankan Safe 2 dari 3. Kebocoran kunci worker tidak lagi berarti kendali penuh.

**B2. Suara bertanda tangan anggota (EIP-712).** Anggota menandatangani pesan terstruktur `Vote(proposalId, memberId, approve, deadline)` dengan dompetnya. Contract menghitung ulang hash pesan dan memeriksa bahwa penanda tangan adalah alamat anggota yang terdaftar ([pola EIP-712](https://github.com/Thaddeus19/useful-solidity-patterns/blob/main/patterns/eip712-signed-messages), [contoh vote by signature](https://docs.onyx.org/governance/vote-by-signature)). Operator hanya meneruskan transaksi dan membayar gas, jadi anggota tidak perlu ETH. Konsekuensi: `addMember` perlu menyimpan alamat dompet anggota, dan frontend perlu tombol tanda tangan dompet.

**B3. Oracle.** Chainlink Functions memungkinkan contract meminta jaringan node oracle menjalankan kode yang memanggil API eksternal lalu mengembalikan hasilnya ke chain ([Chainlink Functions](https://docs.chain.link/chainlink-functions/getting-started), [tutorial panggil API](https://docs.chain.link/chainlink-functions/tutorials/api-query-parameters)). Untuk LingkarPay, node oracle menanyakan Status API Midtrans untuk satu order, sehingga status bayar tidak hanya bergantung pada backend. Hambatannya: Server Key Midtrans harus disimpan sebagai rahasia terenkripsi di jaringan oracle, dan ada biaya per permintaan. Alternatif yang lebih sederhana: pembayaran baru dianggap sah on-chain bila ditandatangani dua pihak (backend dan mitra berizin).

**B4. Rem darurat.** `Pausable` menghentikan fungsi tertentu saat ada insiden, dan `AccessControl` membagi peran (admin, pencatat, penjeda) ([OpenZeppelin Access Control](https://docs.openzeppelin.com/contracts/access-control)). Peran admin dipegang multisig dari B1.

**B5. Verifikasi tanpa memercayai server.** Ini satu-satunya celah yang bisa ditutup tanpa contract baru: halaman Verifikasi membaca `getCircle`, `getPeriod`, dan `getPayment` langsung dari Sepolia, lalu menandai bila berbeda dengan data server.

## 3. Posisi konsep blockchain

| Konsep | Status |
|---|---|
| Ledger berurutan dan tidak bisa diubah | Terpenuhi (dijamin Ethereum Sepolia) |
| Transparansi dan verifikasi publik | Terpenuhi (kode terverifikasi, state dapat dibaca siapa pun) |
| Aturan otomatis lewat smart contract | Terpenuhi (giliran terkunci, tanpa catatan ganda, kuorum, status periode) |
| Konsensus | Terpenuhi lewat Proof of Stake Ethereum |
| Desentralisasi penulisan | Belum: satu operator; dijawab B1 dan B2 |
| Tanpa perlu percaya (trustless) | Sebagian: aturan tanpa percaya, masukan data masih lewat operator; dijawab B2 dan B3 |
| Nilai bergerak di chain | Tidak, sengaja: rupiah lewat pihak berizin (arsitektur A) |

Kalimat untuk presentasi: blockchain dipakai sebagai buku besar aturan dan bukti yang dapat diaudit publik; penegakan aturan on-chain sudah nyata, sedangkan masukan data masih lewat operator tepercaya, dan rancangan v3 (multisig, suara bertanda tangan, oracle) menutup celah itu.

## 4. Urutan pengerjaan yang disarankan

1. Sebelum presentasi: B5 (portal membaca chain), karena tidak mengubah contract.
2. Contract v3: B4 dan B1 bersamaan (peran dan pause), lalu B2 (suara EIP-712 dengan alamat dompet anggota).
3. Sebelum produksi: B3 (oracle atau tanda tangan ganda), B6 (audit), dan penyimpanan batas laju bersama.
