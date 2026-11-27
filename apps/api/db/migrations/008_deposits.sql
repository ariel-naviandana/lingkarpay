-- Dana jaminan: setiap anggota menyetor jaminan sebelum kelompok dikunci. Jaminan menutup tunggakan
-- yang tidak bisa lagi dipotong dari jatah (giliran penunggak sudah lewat, atau kelompok selesai),
-- dan sisanya dikembalikan ke rekening anggota saat kelompok selesai atau dibatalkan.
-- Kelompok lama (deposit_amount = 0) tidak mewajibkan jaminan.
ALTER TABLE circles ADD COLUMN deposit_amount BIGINT NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0);

-- Kelompok draft bisa dibatalkan pembuatnya (jaminan yang sudah disetor dikembalikan).
ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_status_check;
ALTER TABLE circles ADD CONSTRAINT circles_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'cancelled'));

-- Order setoran jaminan tidak terikat periode.
ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'contribution'
  CHECK (kind IN ('contribution', 'deposit'));
ALTER TABLE orders ALTER COLUMN period_id DROP NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_kind_period
  CHECK ((kind = 'deposit' AND period_id IS NULL) OR (kind = 'contribution' AND period_id IS NOT NULL));
CREATE UNIQUE INDEX orders_one_active_deposit
  ON orders (member_id)
  WHERE kind = 'deposit' AND status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED');

CREATE TABLE deposits (
  member_id      INTEGER     PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  circle_id      INTEGER     NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  order_id       INTEGER     NOT NULL UNIQUE REFERENCES orders(id),
  amount         BIGINT      NOT NULL CHECK (amount > 0),
  used_amount    BIGINT      NOT NULL DEFAULT 0 CHECK (used_amount >= 0 AND used_amount <= amount),
  status         TEXT        NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'refunded')),
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pengembalian sisa jaminan (transfer simulasi ke rekening anggota, salinan tersamar).
  refund_amount  BIGINT,
  refund_channel TEXT,
  refund_last4   TEXT,
  refund_name    TEXT,
  refund_ref     TEXT,
  refunded_at    TIMESTAMPTZ
);
CREATE INDEX deposits_circle ON deposits (circle_id);

-- Tunggakan yang ditutup dari jaminan penunggak.
ALTER TABLE arrears DROP CONSTRAINT IF EXISTS arrears_status_check;
ALTER TABLE arrears ADD CONSTRAINT arrears_status_check
  CHECK (status IN ('open', 'paid', 'deducted', 'covered'));
