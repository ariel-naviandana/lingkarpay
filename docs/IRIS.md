# Midtrans Iris (payout sandbox) — opsional

Pencairan di prototipe memakai **simulasi** (`POST /payouts/simulate`) dan itu sudah memenuhi alur tugas. Iris menambah bukti bahwa dana benar-benar dikirim lewat layanan penyaluran gateway. Klien Iris di `apps/api/src/services/iris.ts` ditulis dari dokumentasi dan **belum pernah dijalankan**.

## Yang dibutuhkan
1. **Akun Iris sandbox.** Iris adalah produk terpisah dari Snap. Dokumentasi Midtrans menyebut akun sandbox Iris diminta lewat Sales PIC/Support, jadi mungkin tidak tersedia langsung. Coba login ke `https://app.sandbox.midtrans.com/iris` dengan akun Midtrans-mu. Kalau tidak bisa, tetap pakai simulasi dan nyatakan batasannya di dokumentasi dan presentasi (sudah tertulis di `DESIGN.md` bagian 8).
2. **Dua API key Iris**: satu untuk peran **Creator** (membuat payout) dan satu untuk **Approver** (menyetujui). Keduanya dari dashboard Iris. Menu persisnya bisa berbeda; cari bagian API key/Access Keys.
3. **Rekening penerima dummy** yang valid di sandbox Iris (bank dan nomor rekening uji dari dokumentasi/dashboard Iris). Jangan pakai rekening asli.

## Konfigurasi
Di `apps/api/.env` (jangan dikirim ke chat atau di-commit):
```
IRIS_ENABLED=true
IRIS_CREATOR_KEY=<key creator>
IRIS_APPROVER_KEY=<key approver>
# IRIS_OTP=335163     # OTP sandbox dari dokumentasi Iris; ubah bila dashboard memberi nilai lain
```
Restart `npm run dev` setelah mengubah `.env`.

## Mencoba
```powershell
cd C:\coding\lingkarpay\apps\api
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Iris -IrisAccount <nomor rekening dummy> -IrisBank bca
```
Skrip menjalankan alur penuh (dua anggota bayar lewat simulator) lalu memanggil `POST /payouts/iris` dan memeriksa status `APPROVED`. Periksa juga di dashboard Iris bahwa payout muncul dan berstatus approved/processed.

## Yang perlu diverifikasi saat pertama kali dicoba
Hal-hal ini ditulis dari dokumentasi dan belum teruji:
- Bentuk body `POST /iris/api/v1/payouts` (`beneficiary_name`, `beneficiary_account`, `beneficiary_bank`, `beneficiary_email`, `amount` berformat `"20000.00"`, `notes`) dan respons `payouts[0].reference_no`.
- Autentikasi Basic dengan API key sebagai username dan password kosong.
- Header `X-Idempotency-Key` (dikirim untuk mencegah payout ganda).
- Approve: `POST /iris/api/v1/payouts/approve` dengan `reference_nos` dan `otp`.
- Kode bank yang diterima (mis. `bca`) dan apakah beneficiary perlu didaftarkan lebih dulu.

Kalau ada yang salah, pesan error Iris muncul di respons (`IRIS_ERROR`). Kirim pesannya (tanpa key) supaya klien bisa disesuaikan.

## Batasan saat ini
- Status payout berhenti di `APPROVED`. Notifikasi hasil payout dari Iris (processed/failed) belum ditangani.
- Percobaan ulang aman: bila approve gagal, panggilan berikutnya hanya meng-approve ulang payout yang sudah dibuat (tidak membuat payout ganda).
