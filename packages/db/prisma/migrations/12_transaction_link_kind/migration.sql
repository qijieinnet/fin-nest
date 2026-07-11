ALTER TABLE transaction_links
  ADD COLUMN link_kind TEXT NOT NULL DEFAULT 'related';

UPDATE transaction_links
SET link_kind = 'consumable'
WHERE linked_type = 'item';

ALTER TABLE transaction_links
  ADD CONSTRAINT transaction_links_kind_check
  CHECK (link_kind IN ('related', 'consumable', 'purchase'));
