-- Rekening pencairan per anggota (diisi anggota sendiri) dan tujuan transfer per pencairan.
-- Nomor rekening lengkap tidak disimpan: hanya 4 digit terakhir (untuk ditampilkan) dan hash-nya.
ALTER TABLE members
  ADD COLUMN payout_channel            TEXT,         -- kode bank/e-wallet, mis. BCA, GOPAY
  ADD COLUMN payout_account_last4      TEXT,
  ADD COLUMN payout_account_name       TEXT,         -- nama pemilik rekening
  ADD COLUMN payout_account_hash       TEXT,         -- Keccak-256 "kanal:nomor"
  ADD COLUMN payout_account_updated_at TIMESTAMPTZ;

-- Salinan tujuan saat pencairan dibuat, agar riwayat tidak berubah bila anggota mengganti rekening.
ALTER TABLE payouts
  ADD COLUMN destination_channel TEXT,
  ADD COLUMN destination_last4   TEXT,
  ADD COLUMN destination_name    TEXT,
  ADD COLUMN transfer_ref        TEXT,               -- nomor referensi transfer (simulasi atau Iris)
  ADD COLUMN transferred_at      TIMESTAMPTZ;
