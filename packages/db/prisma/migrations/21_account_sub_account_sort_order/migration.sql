-- 账户与子账户支持手动排序：新增 sort_order 列，默认 0，列表按其升序排列。
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "sub_accounts" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
