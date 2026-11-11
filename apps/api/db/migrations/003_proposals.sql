-- 003: kuorum. Usulan menutup periode yang iurannya belum lengkap (keputusan operasional) dan suara
-- anggota. Dicatat ke chain lewat outbox: proposeClosePeriod, castVote, executeProposal.

CREATE TABLE proposals (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circle_id         INTEGER     NOT NULL REFERENCES circles(id),
  period_id         INTEGER     NOT NULL REFERENCES periods(id),
  kind              TEXT        NOT NULL CHECK (kind IN ('close_period')),
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'rejected', 'expired', 'executed')),
  created_by        INTEGER     NOT NULL REFERENCES users(id),
  deadline          TIMESTAMPTZ NOT NULL,
  chain_proposal_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hanya satu usulan yang masih terbuka untuk satu periode.
CREATE UNIQUE INDEX proposals_one_open_per_period ON proposals (period_id) WHERE status = 'open';
CREATE INDEX proposals_circle_idx ON proposals (circle_id);

CREATE TABLE proposal_votes (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id INTEGER     NOT NULL REFERENCES proposals(id),
  member_id   INTEGER     NOT NULL REFERENCES members(id),
  approve     BOOLEAN     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, member_id) -- satu anggota satu suara per usulan
);

ALTER TABLE chain_jobs
  ADD COLUMN proposal_id INTEGER REFERENCES proposals(id),
  ADD COLUMN vote_id     INTEGER REFERENCES proposal_votes(id);

ALTER TABLE chain_jobs
  DROP CONSTRAINT chain_jobs_kind_check,
  DROP CONSTRAINT chain_jobs_shape_check;

ALTER TABLE chain_jobs
  ADD CONSTRAINT chain_jobs_kind_check
    CHECK (kind IN ('createCircle', 'recordPayment', 'markPayout',
                    'proposeClosePeriod', 'castVote', 'executeProposal')),
  ADD CONSTRAINT chain_jobs_shape_check CHECK (
    (kind = 'createCircle'  AND circle_id IS NOT NULL) OR
    (kind = 'recordPayment' AND order_id  IS NOT NULL) OR
    (kind = 'markPayout'    AND payout_id IS NOT NULL) OR
    (kind IN ('proposeClosePeriod', 'executeProposal') AND proposal_id IS NOT NULL) OR
    (kind = 'castVote'      AND vote_id   IS NOT NULL)
  );

CREATE UNIQUE INDEX chain_jobs_proposal_uniq ON chain_jobs (kind, proposal_id) WHERE proposal_id IS NOT NULL;
CREATE UNIQUE INDEX chain_jobs_vote_uniq ON chain_jobs (kind, vote_id) WHERE vote_id IS NOT NULL;
