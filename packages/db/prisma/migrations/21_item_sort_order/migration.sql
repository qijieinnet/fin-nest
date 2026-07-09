-- 物品支持同一类型内手动排序：列表按 sort_order 升序展示。
ALTER TABLE "items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
