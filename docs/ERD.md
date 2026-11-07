# ERD — LingkarPay (jalur payment gateway)

Sumber kebenaran: `apps/api/db/migrations/001_init.sql`. Diagram Mermaid (dapat dirender di GitHub).

```mermaid
erDiagram
  users ||--o{ sessions : memiliki
  users ||--o{ circles : membuat
  users ||--o{ members : menjadi
  circles ||--o{ members : berisi
  circles ||--o{ periods : memiliki
  members ||--o{ orders : membayar
  periods ||--o{ orders : ditagih
  periods ||--o| payouts : dicairkan
  members ||--o{ payouts : menerima
  orders ||--o{ order_status_history : riwayat
  orders ||--o| chain_jobs : recordPayment
  payouts ||--o| chain_jobs : markPayout
  chain_jobs ||--o{ chain_transactions : percobaan_tx
  orders ||..o{ webhook_events : order_id_dari_payload

  users {
    int id PK
    text name
    text email UK
    text password_hash
  }
  sessions {
    text token_hash PK
    int user_id FK
    timestamptz expires_at
  }
  circles {
    int id PK
    text name
    bigint contribution_amount
    int member_count
    int period_days
    int penalty_pct
    bigint admin_fee
    text status "draft|active|completed"
    text chain_circle_id "diisi jalur kontrak"
    int created_by FK
  }
  members {
    int id PK
    int circle_id FK
    int user_id FK
    text member_ref UK "ID samaran on-chain"
    int turn_order "terkunci saat start"
  }
  periods {
    int id PK
    int circle_id FK
    int period_no
    timestamptz due_date
    text status "scheduled|running|ready_payout|done"
    int recipient_member_id FK
  }
  orders {
    int id PK
    text order_id UK "dikirim ke Midtrans"
    int member_id FK
    int period_id FK
    bigint amount
    bigint penalty_amount
    bigint admin_fee
    bigint gross_amount
    text status "PENDING|SETTLED|SETTLED_PENDING_CHAIN|ANCHORED|FAILED|EXPIRED"
    text idempotency_key UK
    text gateway_ref
    text snap_token
    timestamptz expires_at
  }
  order_status_history {
    int id PK
    int order_id FK
    text from_status
    text to_status
    text reason
  }
  webhook_events {
    int id PK
    text order_id
    text payload_hash UK
    bool signature_valid
    text outcome
    jsonb payload
  }
  payouts {
    int id PK
    int period_id FK "unik"
    int recipient_member_id FK
    bigint amount
    text mode "simulated|iris"
    text status
    text recipient_account_hash
    text payout_ref_hash
  }
  chain_jobs {
    int id PK
    text kind "recordPayment|markPayout"
    int order_id FK
    int payout_id FK
    jsonb payload
    text status "queued|sent|confirmed|failed"
    int attempts
  }
  chain_transactions {
    int id PK
    int job_id FK
    text tx_hash
    text ref_hash
    text status "pending|confirmed|failed"
  }
```

## Aturan integritas penting
- `orders.gross_amount = amount + penalty_amount + admin_fee` (CHECK).
- Satu iuran aktif per anggota per periode: indeks unik parsial pada `orders (member_id, period_id)` untuk status PENDING/SETTLED/SETTLED_PENDING_CHAIN/ANCHORED. Order FAILED/EXPIRED boleh digantikan.
- Satu job per order dan per payout: indeks unik parsial `chain_jobs (kind, order_id)` dan `(kind, payout_id)`.
- Uang selalu BIGINT rupiah.
- Data on-chain hanya `member_ref` dan hash (tanpa nama, email, atau nomor rekening).
