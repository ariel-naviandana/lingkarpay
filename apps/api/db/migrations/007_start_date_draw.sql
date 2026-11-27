-- Tanggal mulai yang direncanakan: kelompok baru bisa dikunci pada atau sesudah tanggal ini (WIB).
ALTER TABLE circles ADD COLUMN start_date DATE;
UPDATE circles SET start_date = (created_at AT TIME ZONE 'Asia/Jakarta')::date WHERE start_date IS NULL;
ALTER TABLE circles ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE circles ALTER COLUMN start_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date);

-- Seed undian urutan giliran (dibuka setelah kelompok dimulai agar urutan bisa diperiksa ulang).
ALTER TABLE circles ADD COLUMN draw_seed TEXT;

-- Kapan periode dibuka. Tenggat periode yang dibuka terlambat digeser agar tetap mendapat waktu penuh.
ALTER TABLE periods ADD COLUMN opened_at TIMESTAMPTZ;
UPDATE periods p SET opened_at = c.started_at
  FROM circles c
 WHERE c.id = p.circle_id AND p.status <> 'scheduled' AND p.opened_at IS NULL;
