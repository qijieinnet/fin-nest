ALTER TABLE auto_rules
  DROP CONSTRAINT auto_rules_type_check,
  ADD CONSTRAINT auto_rules_type_check CHECK (type IN ('expense', 'income', 'transfer')),
  ALTER COLUMN category_id DROP NOT NULL,
  ADD COLUMN from_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN from_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  ADD COLUMN to_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN to_sub_account_id UUID NULL REFERENCES sub_accounts(id);

ALTER TABLE auto_pending_transactions
  DROP CONSTRAINT auto_pending_transactions_type_check,
  ADD CONSTRAINT auto_pending_transactions_type_check CHECK (type IN ('expense', 'income', 'transfer')),
  ALTER COLUMN category_id DROP NOT NULL,
  ADD COLUMN from_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN from_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  ADD COLUMN to_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN to_sub_account_id UUID NULL REFERENCES sub_accounts(id);
