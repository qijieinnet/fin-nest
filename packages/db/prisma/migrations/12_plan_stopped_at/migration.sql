ALTER TABLE plans
  ADD COLUMN stopped_at TIMESTAMPTZ(6);

CREATE INDEX plans_ledger_stopped_archived_idx ON plans(ledger_id, stopped_at, archived_at);
