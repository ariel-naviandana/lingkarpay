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

## Angka dari prototipe yang bisa dipakai
Nilai ini dari implementasi saat ini dan dapat jadi dasar perhitungan (ubah di `circles.admin_fee` / `DEFAULT_ADMIN_FEE`):
- Biaya admin per iuran di prototipe: Rp1.000 (asumsi, belum divalidasi ke pengguna).
- Dana pencairan = iuran + penalti; biaya admin tidak ikut dicairkan (pendapatan LingkarPay).
- Penalti keterlambatan: persentase tetap dari iuran, dibulatkan ke atas.
- Biaya Midtrans (MDR per kanal) dan biaya gas Sepolia belum diperhitungkan di kode; ambil dari tarif resmi saat menyusun unit economics.

Referensi: `docs/DESIGN.md` bagian 5 (tagihan) dan bagian 8 (pencairan), proposal Bab IV dan V.
