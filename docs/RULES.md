# Aturan Kerja — Jalur Payment Gateway LingkarPay

Berlaku untuk semua pekerjaan di `apps/api`. Ringkas dan bisa dicek.

## 1. Git
- Satu langkah pengerjaan = satu commit kecil (boleh lebih dari satu bila memang terpisah logis).
- Format pesan commit (Conventional Commits): `feat(api): ...`, `fix(api): ...`, `docs: ...`, `test(api): ...`, `chore: ...`.
- Setelah commit langsung `git push`. Jangan menumpuk commit lokal.
- Sebelum commit: jalankan `git status`, periksa `git diff --cached`, pastikan tidak ada `.env`, key, atau token.
- Jangan `git push --force` dan jangan menulis ulang riwayat (riwayat per anggota dinilai).
- Jangan menyentuh folder jalur lain (`apps/web`, `contracts`, modul chain) kecuali lewat antarmuka yang disepakati di `docs/`.

## 2. Keamanan (standar tugas)
- Server Key, Client Key, private key penanda tangan hanya di `.env` (sudah di `.gitignore`). Tidak boleh di kode, log, commit, atau chat.
- `.env.example` hanya berisi nama variabel dan nilai contoh palsu.
- Server Key dibuat dengan izin seminimal mungkin: Snap Checkout, Core API, Cancel transaction, dan Expire transaction = Write; refund dan produk lain = None. Setelah mengganti key, revoke key lama.
- Log tidak boleh mencetak header otorisasi, Server Key, atau payload lengkap yang memuat data pribadi.
- Hanya sandbox dan data dummy. Bayar hanya lewat simulator Midtrans, bukan aplikasi bank sungguhan.
- Hindari QRIS di sandbox (referensinya bisa terhubung ke merchant produksi). Pakai VA dan e-wallet.

## 3. Pembayaran
- Sumber kebenaran status bayar hanya: (a) webhook dengan signature terverifikasi, atau (b) Status API Midtrans. Halaman redirect setelah bayar hanya tampilan.
- Signature webhook: `SHA512(order_id + status_code + gross_amount + kunci)`; kuncinya Signature Secret Key (`MIDTRANS_SIGNATURE_KEY`) bila diisi, jika tidak Server Key. Pada dashboard sandbox kelompok, Server Key tidak cocok dan Signature Secret Key dipakai. `gross_amount` dipakai sebagai string persis seperti diterima. Jangan diformat ulang.
- Bandingkan signature dengan perbandingan waktu-konstan (`crypto.timingSafeEqual`).
- Webhook wajib: verifikasi signature, cek duplikat, cek `gross_amount` sama dengan tagihan, baru ubah status.
- Webhook selalu membalas cepat (HTTP 200) setelah event tercatat. Pekerjaan lanjutan lewat outbox, bukan di dalam request.
- Notifikasi bisa datang tidak berurutan atau berulang. Status final tidak boleh diturunkan. Bila ragu, tanya Status API.
- Uang disimpan sebagai bilangan bulat rupiah (`BIGINT`), tidak pernah float.

## 4. Kode
- TypeScript strict. Validasi semua input dengan skema (zod).
- Variabel lingkungan dibaca dan divalidasi satu tempat (`src/config.ts`). Gagal start bila ada yang kurang.
- Struktur: `routes/` (HTTP tipis), `services/` (logika), `db/` (akses data), `lib/` (util). Logika bisnis tidak di dalam handler.
- Perubahan status pesanan hanya lewat satu modul mesin status. Tidak ada `UPDATE orders SET status` di tempat lain.
- Setiap fitur dengan logika (signature, status, tagihan, idempotensi) punya tes otomatis sebelum commit.
- Node sering memilih IPv6 dulu di Windows dan timeout: `dns.setDefaultResultOrder('ipv4first')` di titik masuk server.

## 5. Lingkungan
- Windows + PowerShell. Perintah di dokumen ditulis kompatibel PowerShell.
- URL tunnel Cloudflared berubah tiap restart. Setelah restart, perbarui Notification URL di dashboard Midtrans.

## 6. Definisi selesai (per langkah)
1. Kode jalan lokal.
2. Tes terkait lulus (`npm test`) dan `npm run typecheck` bersih.
3. Dokumen terkait (API/ERD) diperbarui bila antarmuka berubah.
4. Commit lalu push berhasil.
