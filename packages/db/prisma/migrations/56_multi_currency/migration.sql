-- 多币种（设计见 docs/MULTI_CURRENCY_PLAN.md）。
--
-- 口径：transactions.gross/effective_amount_micros 永远是账本本币；账户余额与流水是账户自己的币种。
-- 存量数据全部是本币，迁移只需把账户币种回填成所属账本的本币，原币字段留空，行为与迁移前完全一致。

-- 1) 账户币种：建账后不可改（API 保证），子账户随账户。
ALTER TABLE accounts ADD COLUMN currency CHAR(3);
UPDATE accounts a SET currency = l.currency FROM ledgers l WHERE l.id = a.ledger_id;
UPDATE accounts SET currency = 'CNY' WHERE currency IS NULL;
ALTER TABLE accounts ALTER COLUMN currency SET NOT NULL;

-- 2) 交易：外币那一侧的原币金额；to_* 仅用于「转出、转入都是外币且币种不同」的转账。
ALTER TABLE transactions
  ADD COLUMN original_currency CHAR(3),
  ADD COLUMN original_amount_micros BIGINT,
  ADD COLUMN to_currency CHAR(3),
  ADD COLUMN to_amount_micros BIGINT,
  ADD CONSTRAINT transactions_original_pair_check
    CHECK ((original_currency IS NULL) = (original_amount_micros IS NULL)),
  ADD CONSTRAINT transactions_original_amount_positive
    CHECK (original_amount_micros IS NULL OR original_amount_micros > 0),
  ADD CONSTRAINT transactions_to_pair_check
    CHECK ((to_currency IS NULL) = (to_amount_micros IS NULL)),
  ADD CONSTRAINT transactions_to_requires_original
    CHECK (to_currency IS NULL OR original_currency IS NOT NULL),
  ADD CONSTRAINT transactions_to_amount_positive
    CHECK (to_amount_micros IS NULL OR to_amount_micros > 0);

-- 3) 自动记账规则 / 待确认 / 快捷模板：amount_micros 仍是本币（规则与模板里是估算值）。
ALTER TABLE auto_rules
  ADD COLUMN original_currency CHAR(3),
  ADD COLUMN original_amount_micros BIGINT,
  ADD CONSTRAINT auto_rules_original_pair_check
    CHECK ((original_currency IS NULL) = (original_amount_micros IS NULL));
ALTER TABLE auto_pending_transactions
  ADD COLUMN original_currency CHAR(3),
  ADD COLUMN original_amount_micros BIGINT,
  ADD CONSTRAINT auto_pending_transactions_original_pair_check
    CHECK ((original_currency IS NULL) = (original_amount_micros IS NULL));
ALTER TABLE quick_templates
  ADD COLUMN original_currency CHAR(3),
  ADD COLUMN original_amount_micros BIGINT;

-- 4) 订阅费用币种：空 = 账本本币。
ALTER TABLE subscriptions ADD COLUMN currency CHAR(3);

-- 5) 汇率：ledger_id 为空 = 数据源自动抓取（全局共享）；非空 = 该账本手填，优先于自动。
--    1 单位 from_currency = rate 单位 to_currency。
CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NULL REFERENCES ledgers(id),
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  rate_date DATE NOT NULL,
  rate DECIMAL(24, 10) NOT NULL,
  source TEXT NOT NULL,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_rate_positive CHECK (rate > 0),
  CONSTRAINT exchange_rates_pair_distinct CHECK (from_currency <> to_currency),
  CONSTRAINT exchange_rates_source_check CHECK (source IN ('manual', 'frankfurter'))
);
-- PG 里 NULL 互不相等，全局行的唯一性要单独一条部分索引兜住。
CREATE UNIQUE INDEX exchange_rates_ledger_pair_date_key
  ON exchange_rates (ledger_id, from_currency, to_currency, rate_date)
  WHERE ledger_id IS NOT NULL;
CREATE UNIQUE INDEX exchange_rates_global_pair_date_key
  ON exchange_rates (from_currency, to_currency, rate_date)
  WHERE ledger_id IS NULL;
CREATE INDEX exchange_rates_pair_date_idx
  ON exchange_rates (from_currency, to_currency, rate_date DESC);
