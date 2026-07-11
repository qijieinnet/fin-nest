-- 人员支持手动排序：新增 sort_order 列，默认 0，列表按其升序排列。
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
