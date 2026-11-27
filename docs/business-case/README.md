# docs/business-case — jalur business case

Belum dimulai. Dikumpulkan 24 November (PDF). Isi yang diminta tugas:

- Ringkasan eksekutif
- Masalah, segmen, dan persona
- Pasar (TAM/SAM/SOM) dan pesaing
- Proposisi nilai dan Business Model Canvas
- Model pendapatan (biaya admin, dana minimal, langganan)
- Biaya operasional: prototipe vs produksi (termasuk biaya gas per transaksi on-chain)
- Proyeksi 3 tahun (unit economics, BEP, NPV)
- Peta regulasi (Bab V dengan arsitektur A: dana ditahan pihak berizin, contract hanya aturan dan audit)
- Risiko, KYC/AML, UU PDP
- Roadmap kasus nyata dan KPI
- Revisi proposal sesuai catatan dosen
- Slide dan video demo

## Angka dari prototipe
Rujukan lengkap dan terbaru: **`docs/ATURAN_BISNIS.md`** (peran, siklus, alur uang, angka di bagian 6, mitigasi risiko, batasan). Ringkasnya:
- Biaya admin per pembayaran iuran atau pelunasan tunggakan: Rp1.000, **ditetapkan platform** (pembuat kelompok tidak bisa mengubah). Asumsi, belum divalidasi ke pengguna (`DEFAULT_ADMIN_FEE`).
- Dana jaminan per anggota: satu iuran + penalti, disetor sebelum kelompok dikunci, tanpa biaya admin, dikembalikan di akhir. Bukan pendapatan.
- Dana pencairan = iuran + penalti periode itu − tunggakan penerima yang dipotong; biaya admin tidak ikut dicairkan (pendapatan LingkarPay).
- Penalti keterlambatan: persentase tetap dari iuran, sekali, dibulatkan ke atas.
- Tunggakan: bayar susulan (+ biaya admin), dipotong dari jatah giliran, atau ditutup dari jaminan; penunggak diblokir dari kelompok baru.
- Urutan giliran diundi sistem dan bisa diperiksa publik; kuorum (mayoritas mutlak, 3 hari) hanya setelah jatuh tempo.
- Biaya Midtrans (MDR per kanal) dan biaya gas mainnet belum diperhitungkan di kode; ambil dari tarif resmi saat menyusun unit economics.

Referensi: `docs/ATURAN_BISNIS.md`, `docs/KEAMANAN.md`, proposal Bab IV dan V.
