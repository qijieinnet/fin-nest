-- 订阅管理：套餐订阅档案 + 物品类型式的独立分类。分类含图标/排序/归档；
-- 订阅交互对齐保险（退订/恢复、同分类内排序、关联交易汇总花费）。

CREATE TABLE subscription_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  name TEXT NOT NULL,
  icon TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL
);

CREATE INDEX subscription_categories_ledger_idx ON subscription_categories(ledger_id);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  category_id UUID NULL REFERENCES subscription_categories(id),
  name TEXT NOT NULL,
  provider TEXT NULL,
  plan_name TEXT NULL,
  price_micros BIGINT NULL,
  billing_cycle TEXT NULL,
  payment_method TEXT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  start_date DATE NULL,
  next_renewal_date DATE NULL,
  note TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  terminated_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT subscriptions_price_nonnegative CHECK (price_micros IS NULL OR price_micros >= 0)
);

CREATE INDEX subscriptions_ledger_idx ON subscriptions(ledger_id);

-- transaction_links 允许订阅作为关联目标。
ALTER TABLE transaction_links DROP CONSTRAINT transaction_links_type_check;
ALTER TABLE transaction_links
  ADD CONSTRAINT transaction_links_type_check
  CHECK (linked_type IN ('insurance', 'item', 'subscription'));

-- 自动记账/待确认/快捷模板可携带订阅关联（对齐保险/物品的 carry link）。
ALTER TABLE auto_rules ADD COLUMN subscription_id UUID NULL REFERENCES subscriptions(id);
ALTER TABLE auto_pending_transactions ADD COLUMN subscription_id UUID NULL REFERENCES subscriptions(id);
ALTER TABLE quick_templates ADD COLUMN subscription_id UUID NULL REFERENCES subscriptions(id);
