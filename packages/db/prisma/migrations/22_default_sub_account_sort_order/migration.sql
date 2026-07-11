-- 默认桶（虚拟子账户）也可参与子账户排序：新增序号列，与命名子账户的 sort_order 共用同一序列。
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "default_sub_account_sort_order" integer NOT NULL DEFAULT 0;
