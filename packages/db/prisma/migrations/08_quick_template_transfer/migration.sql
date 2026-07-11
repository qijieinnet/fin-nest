ALTER TABLE quick_templates
  ALTER COLUMN category_id DROP NOT NULL,
  ADD COLUMN from_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN from_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  ADD COLUMN to_account_id UUID NULL REFERENCES accounts(id),
  ADD COLUMN to_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  DROP CONSTRAINT quick_templates_type_check,
  ADD CONSTRAINT quick_templates_type_check CHECK (type IN ('expense', 'income', 'transfer')),
  ADD CONSTRAINT quick_templates_transfer_accounts_check CHECK (
    (type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
    OR
    (type IN ('expense', 'income') AND category_id IS NOT NULL)
  );

CREATE INDEX quick_templates_from_account_idx ON quick_templates(from_account_id);
CREATE INDEX quick_templates_to_account_idx ON quick_templates(to_account_id);
