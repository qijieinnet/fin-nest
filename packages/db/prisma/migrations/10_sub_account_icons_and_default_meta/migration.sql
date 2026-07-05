ALTER TABLE accounts
  ADD COLUMN default_sub_account_name TEXT NULL,
  ADD COLUMN default_sub_account_icon TEXT NULL;

ALTER TABLE sub_accounts
  ADD COLUMN icon TEXT NULL;
