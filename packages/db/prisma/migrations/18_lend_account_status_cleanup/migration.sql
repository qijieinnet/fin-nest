UPDATE accounts
SET settled_at = NULL
WHERE type IN ('receivable', 'payable')
  AND balance_micros <> 0
  AND settled_at IS NOT NULL;

UPDATE accounts
SET settled_at = NOW()
WHERE type IN ('receivable', 'payable')
  AND balance_micros = 0
  AND settled_at IS NULL;
