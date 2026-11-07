-- LingkarPay: skema awal jalur payment gateway.
-- Uang disimpan sebagai BIGINT rupiah (bilangan bulat). Tidak ada float.

CREATE TABLE users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE circles (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                TEXT        NOT NULL,
  contribution_amount BIGINT      NOT NULL CHECK (contribution_amount > 0),
  member_count        INTEGER     NOT NULL CHECK (member_count >= 2),
  period_days         INTEGER     NOT NULL CHECK (period_days > 0),
  penalty_pct         INTEGER     NOT NULL DEFAULT 0 CHECK (penalty_pct BETWEEN 0 AND 100),
  admin_fee           BIGINT      NOT NULL DEFAULT 0 CHECK (admin_fee >= 0),
  status              TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'completed')),
  chain_circle_id     TEXT,
  created_by          INTEGER     NOT NULL REFERENCES users(id),
  started_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circle_id  INTEGER     NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id),
  member_ref TEXT        NOT NULL UNIQUE,   -- ID samaran untuk on-chain (bukan data pribadi)
  turn_order INTEGER,                       -- terkunci saat kelompok dimulai
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (circle_id, user_id),
  UNIQUE (circle_id, turn_order)
);

CREATE TABLE periods (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circle_id           INTEGER     NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  period_no           INTEGER     NOT NULL,
  due_date            TIMESTAMPTZ NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'running', 'ready_payout', 'done')),
  recipient_member_id INTEGER     REFERENCES members(id),
  UNIQUE (circle_id, period_no)
);

CREATE TABLE orders (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        TEXT        NOT NULL UNIQUE,      -- order_id yang dikirim ke Midtrans (maks 50 karakter)
  member_id       INTEGER     NOT NULL REFERENCES members(id),
  period_id       INTEGER     NOT NULL REFERENCES periods(id),
  amount          BIGINT      NOT NULL CHECK (amount > 0),         -- iuran
  penalty_amount  BIGINT      NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  admin_fee       BIGINT      NOT NULL DEFAULT 0 CHECK (admin_fee >= 0),
  gross_amount    BIGINT      NOT NULL CHECK (gross_amount = amount + penalty_amount + admin_fee),
  status          TEXT        NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN',
                                    'ANCHORED', 'FAILED', 'EXPIRED')),
  idempotency_key TEXT        NOT NULL UNIQUE,
  gateway_ref     TEXT,                              -- transaction_id Midtrans
  payment_type    TEXT,
  snap_token      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu iuran aktif per anggota per periode. Order FAILED/EXPIRED boleh diganti order baru.
CREATE UNIQUE INDEX orders_one_active_per_member_period
  ON orders (member_id, period_id)
  WHERE status IN ('PENDING', 'SETTLED', 'SETTLED_PENDING_CHAIN', 'ANCHORED');

CREATE TABLE order_status_history (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT        NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           TEXT,                           -- dari payload; mungkin tidak ada di tabel orders
  payload_hash       TEXT        NOT NULL UNIQUE,    -- dedupe notifikasi berulang
  transaction_status TEXT,
  signature_valid    BOOLEAN     NOT NULL,
  processed          BOOLEAN     NOT NULL DEFAULT FALSE,
  outcome            TEXT,                           -- applied | ignored_transition | unknown_order | amount_mismatch | invalid_signature
  payload            JSONB       NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id             INTEGER     NOT NULL UNIQUE REFERENCES periods(id),
  recipient_member_id   INTEGER     NOT NULL REFERENCES members(id),
  amount                BIGINT      NOT NULL CHECK (amount > 0),
  mode                  TEXT        NOT NULL DEFAULT 'simulated' CHECK (mode IN ('simulated', 'iris')),
  status                TEXT        NOT NULL DEFAULT 'SIMULATED'
                        CHECK (status IN ('SIMULATED', 'QUEUED', 'APPROVED', 'COMPLETED', 'FAILED')),
  iris_reference_no     TEXT,
  recipient_account_hash TEXT,                       -- Keccak-256 rekening penerima, bukan nomor aslinya
  payout_ref_hash       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox: antarmuka ke modul chain (jalur smart contract).
CREATE TABLE chain_jobs (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            TEXT        NOT NULL CHECK (kind IN ('recordPayment', 'markPayout')),
  order_id        INTEGER     REFERENCES orders(id),
  payout_id       INTEGER     REFERENCES payouts(id),
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sent', 'confirmed', 'failed')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'recordPayment' AND order_id IS NOT NULL) OR
    (kind = 'markPayout'    AND payout_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX chain_jobs_order_uniq  ON chain_jobs (kind, order_id)  WHERE order_id  IS NOT NULL;
CREATE UNIQUE INDEX chain_jobs_payout_uniq ON chain_jobs (kind, payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX chain_jobs_queue ON chain_jobs (status, next_attempt_at);

CREATE TABLE chain_transactions (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id       INTEGER     NOT NULL REFERENCES chain_jobs(id) ON DELETE CASCADE,
  tx_hash      TEXT,
  ref_hash     TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  attempts     INTEGER     NOT NULL DEFAULT 1,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_idx        ON orders (status);
CREATE INDEX orders_period_idx        ON orders (period_id);
CREATE INDEX webhook_events_order_idx ON webhook_events (order_id);
