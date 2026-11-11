# Runbook Demo — jalur payment gateway

Untuk progress report (di kelas, sebelum 24 November) dan presentasi (mulai 26 November). Bagian ini hanya sisi payment gateway; alur lengkap dengan smart contract dilengkapi jalur kontrak.

## H-1: persiapan
- [ ] Docker Desktop menyala, `docker compose up -d` (Postgres).
- [ ] Server key punya izin Snap Checkout, Core API, Cancel transaction, dan Expire transaction = Write (lihat `apps/api/README.md`).
- [ ] `apps\api\.env` berisi: `DATABASE_URL`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_SIGNATURE_KEY`.
- [ ] `npm run migrate`, `npm run typecheck`, `npm test` (87 tes lulus).
- [ ] Nyalakan tunnel **sekali** dan jangan dimatikan: `cloudflared tunnel --url http://localhost:3001`. Salin alamatnya ke Notification URL di dashboard Midtrans (`.../midtrans-webhook`), Save, reload untuk memastikan.
- [ ] `powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Both` lolos semua.
- [ ] Rekam **video demo cadangan** dari smoke test (koneksi ke Midtrans sempat lambat, tunnel gratis tanpa jaminan).
- [ ] Siapkan tab: Midtrans simulator (`https://simulator.sandbox.midtrans.com/`), dashboard Midtrans (Notification history dan Transactions), terminal server (log), terminal skrip.

## Alur demo (sekitar 7 menit)
1. **Konteks (30 dtk).** Arisan digital: iuran lewat payment gateway, aturan di smart contract. Bagian ini: dari klik bayar sampai status berubah dan antre ke blockchain.
2. **Jalankan** `smoke.ps1 -Both`. Sambil berjalan, jelaskan langkah yang tampil:
   - Buat kelompok, tambah anggota, mulai: urutan giliran terkunci, job `createCircle` diantre.
   - Checkout: tagihan Rp11.000 = iuran Rp10.000 + biaya admin Rp1.000; checkout ulang mengembalikan order yang sama (idempoten).
3. **Bayar di simulator** (VA BCA). Tunjukkan di log server: `webhook diproses ... outcome: applied`, dan di dashboard Midtrans: Notification history **Completed**.
4. **Tunjukkan status** `GET /orders/<orderId>`: riwayat status PENDING → SETTLED, `chainStatus: queued` (outbox menunggu modul chain).
5. **Pembayaran kedua** → periode siap cair → **pencairan simulasi** Rp20.000 (iuran saja; biaya admin pendapatan LingkarPay) → periode 2 dibuka.
6. **Rekonsiliasi** `GET /reports/reconciliation?circleId=...`: selisih terkumpul vs dicairkan = 0, `issues=0`.
7. **Keamanan (1 menit).** Tunjukkan tes otomatis (`npm test`): signature palsu ditolak (401), jumlah tidak cocok ditolak, notifikasi duplikat diabaikan, notifikasi tidak berurutan tidak menurunkan status.
8. **Sambungan ke blockchain.** Tunjukkan satu baris `chain_jobs` (payload tanpa data pribadi) dan jelaskan: modul chain mengambil job, mencatat ke contract di Sepolia, lalu memanggil `markJobConfirmed` sehingga order menjadi ANCHORED.

## Skenario tambahan (bila waktu cukup)
Dari `apps\api`. Semuanya di Midtrans sandbox; di halaman Snap pilih Bank Transfer > BCA (jangan dibayar) atau e-wallet.
| Skenario | Perintah | Yang ditunjukkan |
|---|---|---|
| E-wallet | `smoke-scenarios.ps1 -Scenario Ewallet` | Bayar GoPay lewat simulator; status SETTLED |
| Kedaluwarsa | `smoke-scenarios.ps1 -Scenario Expire -ApiExpire` | Order EXPIRED, anggota bisa membayar lagi |
| Dibatalkan | `smoke-scenarios.ps1 -Scenario Cancel -ApiCancel` | Order FAILED, anggota bisa membayar lagi |

Bagian "tercatat di blockchain" (langkah 8) bisa didemokan penuh di Sepolia: nyalakan `npm run chain:worker` dengan `.env` yang menunjuk ke Sepolia, lalu setelah order `ANCHORED` buka `https://sepolia.etherscan.io/address/0xF3Fde971c32960224395ceB9F0b5712dcFFc06A0` (tab Transactions) dan jalankan `npm run inspect` di folder `contracts`. Satu transaksi di Sepolia butuh sekitar 12 detik, jadi siapkan screenshot dan video cadangan. Bukti dan perintah: `docs/BUKTI_SEPOLIA.md`.

## Jika ada yang gagal
| Masalah | Tindakan |
|---|---|
| Webhook tidak masuk (status PENDING terus) | Cek tunnel hidup dan Notification URL; skrip otomatis memakai `?sync=true` (Status API) sebagai cadangan setelah ~30 dtk. |
| Snap lambat/timeout | Coba ulang; sudah ada retry. Putar video cadangan bila perlu. |
| Alamat tunnel berubah | Perbarui Notification URL di dashboard Midtrans. |
| Port atau database error | `docker compose up -d`, `npm run migrate`, restart `npm run dev`. |

## Pertanyaan yang mungkin muncul
- **Apakah Midtrans bisa terhubung ke Ethereum?** Tidak langsung. Midtrans mengirim webhook HTTP ke backend; backend memverifikasi signature, lalu mencatat hasilnya ke smart contract lewat modul chain (outbox). Backend adalah jembatan dan satu-satunya titik kepercayaan di sisi penghubung (oracle problem; diakui di proposal Bab II.D).
- **Kenapa status bayar dari webhook, bukan dari halaman redirect?** Halaman redirect hanya tampilan di browser pengguna dan bisa dipalsukan atau tidak pernah terbuka. Webhook bertanda tangan (atau Status API) adalah sumber kebenaran.
- **Bagaimana kalau blockchain gagal setelah pembayaran sah?** Pembayaran tetap sah (SETTLED). Pencatatan on-chain diulang dengan backoff terpisah; status SETTLED_PENDING_CHAIN; operator bisa mengantrekan ulang. Dana tidak terkunci oleh kegagalan chain.
- **Bagaimana mencegah pembayaran ganda dan notifikasi ganda?** Satu iuran aktif per anggota per periode (indeks unik), checkout idempoten, notifikasi berulang dideteksi dari hash payload, dan satu pembayaran menghasilkan tepat satu job on-chain.
- **Biaya per transaksi on-chain (gas)?** Di Sepolia memakai ETH uji, jadi tidak ada biaya riil. Untuk produksi: biaya gas per pencatatan dihitung di business case; mitigasi: pencatatan batch atau jaringan layer dua (proposal Bab IV.D).
- **Ada biaya admin dan dana minimal?** Biaya admin per iuran sudah ada di tagihan (prototipe Rp1.000, asumsi) dan tidak ikut dicairkan. Dana minimal diatur lewat nilai iuran minimum Rp1.000 di API; angka yang dipakai ditetapkan di business case.
- **Uang lewat gateway atau di smart contract?** Arsitektur pilihan A: dana ditahan pihak berizin (gateway/mitra), contract hanya aturan dan audit, agar LingkarPay tidak berposisi sebagai penghimpun/penyalur dana. Menyimpan rupiah di contract tidak sesuai ketentuan rupiah sebagai alat pembayaran; hanya layak untuk prototipe dengan token uji (lihat catatan keputusan arsitektur di proposal dan business case).
