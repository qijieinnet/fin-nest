-- 子账户名唯一性只作用于“活跃”行：原来的全表唯一约束 (account_id, name) 会把
-- 已归档（软删除）的子账户也算进去，导致把现有子账户改名成已删除子账户的名字时
-- 触发唯一冲突（P2002 → 409 记录已存在）。改为 partial unique index，仅约束
-- archived_at IS NULL 的行，归档行不再占用名字。

ALTER TABLE sub_accounts DROP CONSTRAINT sub_accounts_account_name_unique;

CREATE UNIQUE INDEX sub_accounts_active_name_unique
  ON sub_accounts (account_id, name)
  WHERE archived_at IS NULL;
