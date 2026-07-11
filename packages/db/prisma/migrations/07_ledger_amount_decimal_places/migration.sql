-- 账本级金额小数位数设置：迁移到 ledgers 表，按账本区分，默认 2 位。
ALTER TABLE "ledgers" ADD COLUMN IF NOT EXISTS "amount_decimal_places" smallint NOT NULL DEFAULT 2;
