-- Undangan anggota: pembuat mengundang, yang diundang menerima (wajib mengisi rekening) atau menolak.
-- Anggota lama dianggap sudah menerima.
ALTER TABLE members
  ADD COLUMN status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active')),
  ADD COLUMN invited_at TIMESTAMPTZ;

-- Tunggakan: iuran anggota yang tidak dibayar saat periode ditutup lewat kuorum.
-- Kreditor = penerima periode itu (yang menerima kurang). Tunggakan dilunasi lewat pembayaran
-- susulan atau dipotong dari jatah penunggak saat gilirannya; dananya diteruskan ke kreditor.
CREATE TABLE arrears (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circle_id          INTEGER     NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  period_id          INTEGER     NOT NULL REFERENCES periods(id),
  debtor_member_id   INTEGER     NOT NULL REFERENCES members(id),
  creditor_member_id INTEGER     NOT NULL REFERENCES members(id),
  amount             BIGINT      NOT NULL CHECK (amount > 0),        -- iuran pokok yang tertunggak
  status             TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'deducted')),
  penalty_amount     BIGINT      NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0), -- penalti saat dilunasi
  settled_order_id   INTEGER     REFERENCES orders(id),             -- dilunasi lewat pembayaran susulan
  settled_payout_id  INTEGER     REFERENCES payouts(id),            -- dipotong dari jatah penunggak
  settled_at         TIMESTAMPTZ,
  -- Penerusan ke kreditor (transfer simulasi), dengan salinan rekening tujuan tersamar.
  forward_amount     BIGINT,
  forward_channel    TEXT,
  forward_last4      TEXT,
  forward_name       TEXT,
  forward_ref        TEXT,
  forwarded_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, debtor_member_id)
);
CREATE INDEX arrears_debtor_open ON arrears (debtor_member_id) WHERE status = 'open';
CREATE UNIQUE INDEX arrears_settled_order ON arrears (settled_order_id) WHERE settled_order_id IS NOT NULL;

-- Potongan tunggakan dari jatah penerima (sudah termasuk penalti); amount = jatah bersih.
ALTER TABLE payouts ADD COLUMN arrears_deducted BIGINT NOT NULL DEFAULT 0 CHECK (arrears_deducted >= 0);
