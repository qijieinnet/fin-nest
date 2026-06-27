-- B0：按 DATABASE_DESIGN.md 建立 v1 业务模型。
-- pgcrypto 提供 gen_random_uuid()；citext 已在 0_enable_extensions 中启用，这里重复声明保证迁移可单独理解。
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  account CITEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT NOT NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  registration_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_single_row CHECK (id = 1)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NULL,
  user_agent TEXT NULL,
  ip INET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  last_seen_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_revoked_idx ON sessions(user_id, revoked_at);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE service_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  allowed_ips CIDR[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  deleted_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE ledger_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_members_role_check CHECK (role IN ('owner', 'member')),
  CONSTRAINT ledger_members_ledger_user_unique UNIQUE (ledger_id, user_id)
);

CREATE INDEX ledger_members_user_removed_idx ON ledger_members(user_id, removed_at);
CREATE INDEX ledger_members_ledger_role_idx ON ledger_members(ledger_id, role);

CREATE TABLE ledger_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  code_hash TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_invites_used_count_nonnegative CHECK (used_count >= 0)
);

CREATE TABLE ledger_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  invite_id UUID NULL REFERENCES ledger_invites(id),
  requester_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  reviewed_by UUID NULL REFERENCES users(id),
  reviewed_at TIMESTAMPTZ NULL,
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_join_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
);

CREATE INDEX ledger_join_requests_ledger_status_idx ON ledger_join_requests(ledger_id, status);
CREATE INDEX ledger_join_requests_requester_status_idx ON ledger_join_requests(requester_user_id, status);
CREATE UNIQUE INDEX ledger_join_requests_one_pending_per_user_idx
  ON ledger_join_requests(ledger_id, requester_user_id)
  WHERE status = 'pending';

CREATE TABLE record_settings (
  ledger_id UUID PRIMARY KEY REFERENCES ledgers(id),
  field_order JSONB NOT NULL,
  visible_fields JSONB NOT NULL,
  acct_required BOOLEAN NOT NULL DEFAULT false,
  person_required BOOLEAN NOT NULL DEFAULT false,
  amount_decimal_places SMALLINT NOT NULL DEFAULT 2,
  updated_by UUID NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT record_settings_decimal_places_check CHECK (amount_decimal_places BETWEEN 0 AND 6)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categories_type_check CHECK (type IN ('expense', 'income')),
  CONSTRAINT categories_ledger_type_name_unique UNIQUE (ledger_id, type, name)
);

CREATE INDEX categories_ledger_type_archived_idx ON categories(ledger_id, type, archived_at);

CREATE TABLE subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  category_id UUID NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  icon TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subcategories_category_name_unique UNIQUE (category_id, name)
);

CREATE INDEX subcategories_category_archived_idx ON subcategories(category_id, archived_at);

CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  name TEXT NOT NULL,
  icon TEXT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT people_ledger_name_unique UNIQUE (ledger_id, name)
);

CREATE INDEX people_ledger_archived_idx ON people(ledger_id, archived_at);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NULL,
  balance_micros BIGINT NOT NULL DEFAULT 0,
  include_in_net_worth BOOLEAN NOT NULL DEFAULT true,
  credit_limit_micros BIGINT NULL,
  investment_cost_micros BIGINT NULL,
  counterparty TEXT NULL,
  due_date DATE NULL,
  bill_day SMALLINT NULL,
  repay_day SMALLINT NULL,
  settled_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_type_check CHECK (type IN ('savings', 'credit', 'invest', 'receivable', 'payable')),
  CONSTRAINT accounts_bill_day_check CHECK (bill_day IS NULL OR bill_day BETWEEN 1 AND 31),
  CONSTRAINT accounts_repay_day_check CHECK (repay_day IS NULL OR repay_day BETWEEN 1 AND 31)
);

CREATE INDEX accounts_ledger_type_archived_idx ON accounts(ledger_id, type, archived_at);

CREATE TABLE sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  balance_micros BIGINT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sub_accounts_account_name_unique UNIQUE (account_id, name)
);

CREATE INDEX sub_accounts_account_archived_idx ON sub_accounts(account_id, archived_at);

CREATE TABLE account_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  balance_before_micros BIGINT NOT NULL,
  balance_after_micros BIGINT NOT NULL,
  delta_micros BIGINT NOT NULL,
  note TEXT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_adjustments_delta_check CHECK (delta_micros = balance_after_micros - balance_before_micros)
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  type TEXT NOT NULL,
  gross_amount_micros BIGINT NOT NULL,
  effective_amount_micros BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  occurred_on DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  category_id UUID NULL REFERENCES categories(id),
  subcategory_id UUID NULL REFERENCES subcategories(id),
  category_snapshot JSONB NULL,
  person_id UUID NULL REFERENCES people(id),
  person_snapshot JSONB NULL,
  account_id UUID NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  from_account_id UUID NULL REFERENCES accounts(id),
  from_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  to_account_id UUID NULL REFERENCES accounts(id),
  to_sub_account_id UUID NULL REFERENCES sub_accounts(id),
  note TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id UUID NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  deleted_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT transactions_type_check CHECK (type IN ('expense', 'income', 'transfer')),
  CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'quick', 'auto', 'import', 'ai')),
  CONSTRAINT transactions_amount_nonnegative CHECK (gross_amount_micros >= 0 AND effective_amount_micros >= 0),
  CONSTRAINT transactions_effective_not_greater_than_gross CHECK (effective_amount_micros <= gross_amount_micros),
  CONSTRAINT transactions_transfer_accounts_check CHECK (
    (type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
    OR (type <> 'transfer')
  )
);

CREATE INDEX transactions_ledger_occurred_on_idx ON transactions(ledger_id, occurred_on DESC);
CREATE INDEX transactions_ledger_type_occurred_on_idx ON transactions(ledger_id, type, occurred_on DESC);
CREATE INDEX transactions_ledger_category_idx ON transactions(ledger_id, category_id);
CREATE INDEX transactions_ledger_person_idx ON transactions(ledger_id, person_id);
CREATE INDEX transactions_ledger_created_by_idx ON transactions(ledger_id, created_by);
CREATE INDEX transactions_account_idx ON transactions(account_id);
CREATE INDEX transactions_from_account_idx ON transactions(from_account_id);
CREATE INDEX transactions_to_account_idx ON transactions(to_account_id);

CREATE TABLE account_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  entry_type TEXT NOT NULL,
  amount_delta_micros BIGINT NOT NULL,
  balance_before_micros BIGINT NOT NULL,
  balance_after_micros BIGINT NOT NULL,
  transaction_id UUID NULL REFERENCES transactions(id),
  adjustment_id UUID NULL REFERENCES account_adjustments(id),
  related_account_id UUID NULL REFERENCES accounts(id),
  note TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_entries_entry_type_check CHECK (
    entry_type IN ('expense', 'income', 'transfer_out', 'transfer_in', 'receivable_increase', 'payable_increase', 'settlement', 'adjustment', 'reversal')
  ),
  CONSTRAINT account_entries_balance_delta_check CHECK (balance_after_micros = balance_before_micros + amount_delta_micros)
);

CREATE INDEX account_entries_ledger_account_occurred_at_idx ON account_entries(ledger_id, account_id, occurred_at DESC);
CREATE INDEX account_entries_transaction_idx ON account_entries(transaction_id);
CREATE INDEX account_entries_adjustment_idx ON account_entries(adjustment_id);

CREATE TABLE transaction_account_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  relation_kind TEXT NOT NULL,
  amount_micros BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transaction_account_relations_kind_check CHECK (
    relation_kind IN ('receivable_from_expense', 'payable_from_income', 'receivable_from_income', 'payable_from_expense')
  ),
  CONSTRAINT transaction_account_relations_amount_positive CHECK (amount_micros > 0)
);

CREATE TABLE transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  linked_type TEXT NOT NULL,
  linked_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transaction_links_type_check CHECK (linked_type IN ('insurance', 'item')),
  CONSTRAINT transaction_links_unique UNIQUE (transaction_id, linked_type, linked_id)
);

CREATE INDEX transaction_links_ledger_target_idx ON transaction_links(ledger_id, linked_type, linked_id);

CREATE TABLE auto_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  type TEXT NOT NULL,
  amount_micros BIGINT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  subcategory_id UUID NULL REFERENCES subcategories(id),
  account_id UUID NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  person_id UUID NULL REFERENCES people(id),
  note TEXT NULL,
  repeat_rule TEXT NOT NULL,
  start_date DATE NOT NULL,
  next_run_on DATE NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT auto_rules_type_check CHECK (type IN ('expense', 'income')),
  CONSTRAINT auto_rules_repeat_rule_check CHECK (repeat_rule IN ('daily', 'weekly', 'monthly', 'yearly', 'once')),
  CONSTRAINT auto_rules_amount_positive CHECK (amount_micros > 0)
);

CREATE TABLE auto_pending_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  auto_rule_id UUID NOT NULL REFERENCES auto_rules(id),
  period_key TEXT NOT NULL,
  scheduled_for DATE NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_micros BIGINT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  subcategory_id UUID NULL REFERENCES subcategories(id),
  account_id UUID NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  person_id UUID NULL REFERENCES people(id),
  note TEXT NULL,
  relation_payload JSONB NULL,
  confirmed_transaction_id UUID NULL REFERENCES transactions(id),
  confirmed_by UUID NULL REFERENCES users(id),
  confirmed_at TIMESTAMPTZ NULL,
  deleted_by UUID NULL REFERENCES users(id),
  deleted_at TIMESTAMPTZ NULL,
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auto_pending_transactions_status_check CHECK (status IN ('pending', 'confirmed', 'deleted')),
  CONSTRAINT auto_pending_transactions_type_check CHECK (type IN ('expense', 'income')),
  CONSTRAINT auto_pending_transactions_amount_positive CHECK (amount_micros > 0),
  CONSTRAINT auto_pending_transactions_rule_period_unique UNIQUE (auto_rule_id, period_key)
);

CREATE INDEX auto_pending_transactions_ledger_status_scheduled_idx
  ON auto_pending_transactions(ledger_id, status, scheduled_for);

CREATE TABLE quick_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  type TEXT NOT NULL,
  name TEXT NULL,
  amount_micros BIGINT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  subcategory_id UUID NULL REFERENCES subcategories(id),
  account_id UUID NULL REFERENCES accounts(id),
  sub_account_id UUID NULL REFERENCES sub_accounts(id),
  person_id UUID NULL REFERENCES people(id),
  note TEXT NULL,
  relation_payload JSONB NULL,
  direct_enabled BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT quick_templates_type_check CHECK (type IN ('expense', 'income')),
  CONSTRAINT quick_templates_amount_positive CHECK (amount_micros IS NULL OR amount_micros > 0)
);

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  kind TEXT NOT NULL,
  metric TEXT NOT NULL,
  name TEXT NOT NULL,
  limit_amount_micros BIGINT NULL,
  limit_count INTEGER NULL,
  start_date DATE NOT NULL,
  repeat_rule TEXT NOT NULL,
  match_rule JSONB NULL,
  foresight_enabled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT plans_kind_check CHECK (kind IN ('expense', 'income')),
  CONSTRAINT plans_metric_check CHECK (metric IN ('amount', 'count')),
  CONSTRAINT plans_repeat_rule_check CHECK (repeat_rule IN ('weekly', 'monthly', 'yearly', 'once')),
  CONSTRAINT plans_metric_value_check CHECK (
    (metric = 'amount' AND limit_amount_micros IS NOT NULL AND limit_amount_micros > 0 AND limit_count IS NULL)
    OR (metric = 'count' AND limit_count IS NOT NULL AND limit_count > 0 AND limit_amount_micros IS NULL)
  )
);

CREATE TABLE budget_settings (
  ledger_id UUID PRIMARY KEY REFERENCES ledgers(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  total_amount_micros BIGINT NULL,
  updated_by UUID NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_settings_total_nonnegative CHECK (total_amount_micros IS NULL OR total_amount_micros >= 0)
);

CREATE TABLE category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  category_id UUID NOT NULL REFERENCES categories(id),
  amount_micros BIGINT NOT NULL,
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT category_budgets_amount_nonnegative CHECK (amount_micros >= 0),
  CONSTRAINT category_budgets_ledger_category_unique UNIQUE (ledger_id, category_id)
);

CREATE INDEX category_budgets_ledger_idx ON category_budgets(ledger_id);

CREATE TABLE insurances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  insurer TEXT NULL,
  method TEXT NULL,
  policy_no TEXT NULL,
  coverage_micros BIGINT NULL,
  premium_micros BIGINT NULL,
  premium_freq TEXT NULL,
  periods INTEGER NULL,
  renewal TEXT NULL,
  coverage_desc TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  note TEXT NULL,
  terminated_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT insurances_amounts_nonnegative CHECK (
    (coverage_micros IS NULL OR coverage_micros >= 0)
    AND (premium_micros IS NULL OR premium_micros >= 0)
  )
);

CREATE TABLE insurance_insured_people (
  insurance_id UUID NOT NULL REFERENCES insurances(id),
  person_id UUID NOT NULL REFERENCES people(id),
  PRIMARY KEY (insurance_id, person_id)
);

CREATE TABLE item_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  name TEXT NOT NULL,
  type_id UUID NULL REFERENCES item_types(id),
  purchase_price_micros BIGINT NULL,
  purchase_date DATE NULL,
  expected_years NUMERIC(6,2) NULL,
  note TEXT NULL,
  scrapped_at TIMESTAMPTZ NULL,
  scrap_date DATE NULL,
  sell_price_micros BIGINT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT items_amounts_nonnegative CHECK (
    (purchase_price_micros IS NULL OR purchase_price_micros >= 0)
    AND (sell_price_micros IS NULL OR sell_price_micros >= 0)
  ),
  CONSTRAINT items_expected_years_positive CHECK (expected_years IS NULL OR expected_years > 0)
);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum TEXT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT files_status_check CHECK (status IN ('attached', 'delete_pending', 'delete_failed')),
  CONSTRAINT files_size_positive CHECK (size_bytes > 0)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  file_id UUID NOT NULL REFERENCES files(id),
  owner_type TEXT NOT NULL,
  owner_id UUID NOT NULL,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attachments_owner_type_check CHECK (owner_type IN ('transaction', 'insurance', 'item')),
  CONSTRAINT attachments_file_owner_unique UNIQUE (file_id, owner_type, owner_id)
);

CREATE INDEX attachments_ledger_owner_idx ON attachments(ledger_id, owner_type, owner_id);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NULL REFERENCES ledgers(id),
  actor_user_id UUID NULL REFERENCES users(id),
  service_token_id UUID NULL REFERENCES service_tokens(id),
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_source_check CHECK (source IN ('user', 'service', 'system'))
);

CREATE TABLE background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT background_jobs_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT background_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts)
);

CREATE INDEX background_jobs_status_run_after_idx ON background_jobs(status, run_after);
CREATE INDEX background_jobs_type_status_idx ON background_jobs(type, status);

CREATE OR REPLACE FUNCTION ensure_transaction_relation_amount_limit()
RETURNS TRIGGER AS $$
DECLARE
  transaction_gross BIGINT;
  relation_total BIGINT;
BEGIN
  SELECT gross_amount_micros
    INTO transaction_gross
    FROM transactions
   WHERE id = NEW.transaction_id;

  IF transaction_gross IS NULL THEN
    RAISE EXCEPTION 'transaction % does not exist', NEW.transaction_id;
  END IF;

  SELECT COALESCE(SUM(amount_micros), 0)
    INTO relation_total
    FROM transaction_account_relations
   WHERE transaction_id = NEW.transaction_id
     AND id <> NEW.id;

  IF relation_total + NEW.amount_micros > transaction_gross THEN
    RAISE EXCEPTION 'transaction relation amount exceeds gross amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_account_relations_amount_limit_trg
BEFORE INSERT OR UPDATE ON transaction_account_relations
FOR EACH ROW EXECUTE FUNCTION ensure_transaction_relation_amount_limit();

CREATE OR REPLACE FUNCTION ensure_transaction_gross_covers_relations()
RETURNS TRIGGER AS $$
DECLARE
  relation_total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_micros), 0)
    INTO relation_total
    FROM transaction_account_relations
   WHERE transaction_id = NEW.id;

  IF relation_total > NEW.gross_amount_micros THEN
    RAISE EXCEPTION 'existing relation amount exceeds transaction gross amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_relation_amount_limit_trg
BEFORE UPDATE OF gross_amount_micros ON transactions
FOR EACH ROW EXECUTE FUNCTION ensure_transaction_gross_covers_relations();
