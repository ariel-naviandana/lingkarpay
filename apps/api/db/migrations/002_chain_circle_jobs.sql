-- 002: job "createCircle" di outbox. Kelompok yang dimulai dicatat ke chain lebih dulu;
-- job pembayaran/pencairan hanya diberikan ke modul chain setelah kelompoknya on-chain.

ALTER TABLE chain_jobs ADD COLUMN circle_id INTEGER REFERENCES circles(id);

-- Ganti semua CHECK lama pada chain_jobs (kind dan bentuk baris berubah).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'chain_jobs'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE chain_jobs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE chain_jobs
  ADD CONSTRAINT chain_jobs_kind_check
    CHECK (kind IN ('createCircle', 'recordPayment', 'markPayout')),
  ADD CONSTRAINT chain_jobs_status_check
    CHECK (status IN ('queued', 'sent', 'confirmed', 'failed')),
  ADD CONSTRAINT chain_jobs_shape_check CHECK (
    (kind = 'createCircle'  AND circle_id IS NOT NULL) OR
    (kind = 'recordPayment' AND order_id  IS NOT NULL) OR
    (kind = 'markPayout'    AND payout_id IS NOT NULL)
  );

CREATE UNIQUE INDEX chain_jobs_circle_uniq ON chain_jobs (kind, circle_id) WHERE circle_id IS NOT NULL;
