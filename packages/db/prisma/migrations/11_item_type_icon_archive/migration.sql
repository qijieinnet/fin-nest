ALTER TABLE item_types
  ADD COLUMN icon TEXT,
  ADD COLUMN archived_at TIMESTAMPTZ(6);
