ALTER TABLE users ADD COLUMN IF NOT EXISTS gold INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS gold_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  amount         INT NOT NULL,
  reason         TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
