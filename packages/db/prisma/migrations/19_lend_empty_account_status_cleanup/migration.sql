UPDATE accounts account
SET settled_at = NULL
WHERE account.type IN ('receivable', 'payable')
  AND account.balance_micros = 0
  AND account.settled_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM account_entries entry
    WHERE entry.account_id = account.id
  );
