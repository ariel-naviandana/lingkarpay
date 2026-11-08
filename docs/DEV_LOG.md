# Log Pengembangan Ide dan Keputusan

Catatan diskusi dan keputusan. Tambahkan entri baru di bawah (terbaru di bawah). Format: tanggal, jalur, keputusan atau temuan, alasan.

## 2026-11-05 — Payment gateway
Akun Midtrans sandbox dan Server Key dibuat. Gateway yang dipilih: Midtrans Snap (dokumentasi sandbox lengkap, termasuk dalam pustaka tugas).

## 2026-11-06 — Payment gateway (spike A)
Pop-up Snap muncul, VA BCA dibayar lewat simulator, status sukses. Server Fastify dengan `/checkout`, `/midtrans-webhook`, dan halaman tes. Tunnel Cloudflared dipakai agar Midtrans dapat menjangkau server lokal.

## 2026-11-08 — Payment gateway: keputusan rancangan
- **Arsitektur dana: pilihan A.** Dana ditahan pihak berizin (gateway/escrow); contract hanya aturan dan audit. Alasan: LingkarPay tidak berposisi sebagai penghimpun/penyalur dana (lihat proposal Bab V).
- **Satu mesin status pesanan** (`PENDING → SETTLED → ANCHORED`, dst.) sebagai satu-satunya tempat status berubah. Alasan: notifikasi gateway bisa berulang atau tidak berurutan; status final tidak boleh diturunkan.
- **Outbox (`chain_jobs`) sebagai antarmuka ke modul chain.** Alasan: pembayaran sah tidak boleh batal hanya karena blockchain gagal; pencatatan on-chain diulang terpisah dengan status `SETTLED_PENDING_CHAIN`.
- **Uang BIGINT rupiah**, tidak pernah float. **`member_ref` samaran** untuk on-chain, tanpa data pribadi (UU PDP).
- **Biaya admin tidak ikut dicairkan**; dana pencairan = iuran + penalti.
- **Penalti di-snapshot saat order dibuat.** Batasan yang diketahui: order PENDING yang dipakai ulang tidak menghitung ulang penalti.
- **Postgres + SQL migrasi biasa (tanpa ORM)** agar mudah dijelaskan saat presentasi.

## 2026-11-08 — Payment gateway: temuan saat uji nyata
- Midtrans mengirim notifikasi ke alamat tunnel tanpa path (`POST /`); server menerima di `/` dan `/midtrans-webhook`.
- Signature notifikasi dan Status API tidak cocok bila dihitung dari Server Key. Dashboard kelompok memisahkan **Signature Secret Key**; memakainya (`MIDTRANS_SIGNATURE_KEY`) membuat signature valid. Server Key tetap dipakai untuk autentikasi API.
- Node sempat timeout (`UND_ERR_CONNECT_TIMEOUT`) ke `api.sandbox.midtrans.com` padahal PowerShell bisa terhubung. Panggilan keluar dipaksa IPv4 dengan retry.
- Saat merancang tes ditemukan race condition di checkout: permintaan kedua bisa menutup order yang belum sempat mendapat token. Diperbaiki dengan menunggu token.
- Smoke test alur penuh (dua anggota, pencairan simulasi) lolos 30 pemeriksaan.

## Template entri
```
## YYYY-MM-DD — <jalur>
Keputusan/temuan, alasan, siapa yang memutuskan, dan dampak ke jalur lain.
```
