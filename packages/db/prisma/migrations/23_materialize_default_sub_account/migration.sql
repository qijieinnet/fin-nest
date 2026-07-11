-- 实体化默认子账户：把原本用 sub_account_id IS NULL 表示的“默认桶”变成真实子账户记录。
-- 仅对 money 账户（储蓄/信用/投资）生效；往来账户（可收回/需归还）无子账户概念，保留 NULL。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) 子账户新增“默认”标记。
ALTER TABLE "sub_accounts" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;

-- 2) 为每个 money 账户预分配一个默认子账户 id（含已归档账户，保证历史流水可映射）。
CREATE TEMP TABLE "_default_subs" ON COMMIT DROP AS
SELECT a.id AS account_id, gen_random_uuid() AS sub_id
FROM "accounts" a
WHERE a.type IN ('savings', 'credit', 'invest');

-- 3) 写入默认子账户。余额 = 账户总额 − 现有命名子账户之和（即当前默认桶余额）；
--    名称/图标/净资产开关/排序序号沿用账户上的默认桶元数据；名称与既有子账户冲突时用 id 前缀兜底。
INSERT INTO "sub_accounts" (
  id, ledger_id, account_id, name, icon, balance_micros,
  include_in_net_worth, sort_order, is_default, archived_at,
  created_by, updated_by, created_at, updated_at
)
SELECT
  d.sub_id,
  a.ledger_id,
  a.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "sub_accounts" s
      WHERE s.account_id = a.id AND s.name = COALESCE(a.default_sub_account_name, '默认')
    )
    THEN '默认-' || substr(d.sub_id::text, 1, 8)
    ELSE COALESCE(a.default_sub_account_name, '默认')
  END,
  COALESCE(a.default_sub_account_icon, a.icon),
  a.balance_micros - COALESCE((
    SELECT SUM(s.balance_micros) FROM "sub_accounts" s
    WHERE s.account_id = a.id AND s.archived_at IS NULL
  ), 0),
  COALESCE(a.default_bucket_include_in_net_worth, true),
  COALESCE(a.default_sub_account_sort_order, 0),
  true,
  NULL,
  a.created_by,
  a.updated_by,
  now(),
  now()
FROM "accounts" a
JOIN "_default_subs" d ON d.account_id = a.id;

-- 4) 把“落在默认桶”（sub_account_id IS NULL 且账户为 money）的历史记录回填为默认子账户 id。
UPDATE "account_entries" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;

UPDATE "account_adjustments" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;

UPDATE "transactions" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;
UPDATE "transactions" t SET from_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.from_account_id = d.account_id AND t.from_sub_account_id IS NULL;
UPDATE "transactions" t SET to_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.to_account_id = d.account_id AND t.to_sub_account_id IS NULL;

UPDATE "auto_rules" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;
UPDATE "auto_rules" t SET from_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.from_account_id = d.account_id AND t.from_sub_account_id IS NULL;
UPDATE "auto_rules" t SET to_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.to_account_id = d.account_id AND t.to_sub_account_id IS NULL;

UPDATE "auto_pending_transactions" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;
UPDATE "auto_pending_transactions" t SET from_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.from_account_id = d.account_id AND t.from_sub_account_id IS NULL;
UPDATE "auto_pending_transactions" t SET to_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.to_account_id = d.account_id AND t.to_sub_account_id IS NULL;

UPDATE "quick_templates" t SET sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.account_id = d.account_id AND t.sub_account_id IS NULL;
UPDATE "quick_templates" t SET from_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.from_account_id = d.account_id AND t.from_sub_account_id IS NULL;
UPDATE "quick_templates" t SET to_sub_account_id = d.sub_id
FROM "_default_subs" d WHERE t.to_account_id = d.account_id AND t.to_sub_account_id IS NULL;

-- 5) 移除账户上的默认桶元数据列，真相收敛到默认子账户记录。
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "default_sub_account_name";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "default_sub_account_icon";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "default_bucket_include_in_net_worth";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "default_sub_account_sort_order";
