-- 保险分类拥有独立的持久化顺序；现有分类按首次创建保单的时间初始化。
CREATE TABLE "insurance_type_orders" (
  "ledger_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insurance_type_orders_pkey" PRIMARY KEY ("ledger_id", "type")
);

CREATE INDEX "insurance_type_orders_ledger_id_sort_order_idx"
  ON "insurance_type_orders"("ledger_id", "sort_order");

WITH "type_first_created" AS (
  SELECT "ledger_id", "type", MIN("created_at") AS "first_created_at"
  FROM "insurances"
  WHERE "deleted_at" IS NULL
  GROUP BY "ledger_id", "type"
)
INSERT INTO "insurance_type_orders" ("ledger_id", "type", "sort_order")
SELECT
  "ledger_id",
  "type",
  (ROW_NUMBER() OVER (
    PARTITION BY "ledger_id"
    ORDER BY "first_created_at", "type"
  ) - 1)::INTEGER
FROM "type_first_created";
