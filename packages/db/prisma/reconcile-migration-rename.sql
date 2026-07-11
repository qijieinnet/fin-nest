-- 迁移目录改名对账脚本
-- =====================
-- 背景：历史迁移目录用未补零、且被复用的数字前缀（如四个 `10_`），Prisma 按目录名
-- 字典序应用迁移，导致对「全新空库」执行 `prisma migrate deploy` 时顺序错乱而失败
-- （例如 `19_materialize_default_sub_account` 早于加列的 `9_sub_account_net_worth` 执行）。
-- 现已将目录按真实创建顺序补零重排为 `00_`..`30_`，仅改目录名、不改 migration.sql 内容，
-- 因此各迁移 checksum 不变。
--
-- Prisma 靠 migration_name 匹配已应用记录，所以每个「已经应用过旧命名迁移」的数据库，
-- 必须在下一次 pnpm db:migrate / pnpm db:deploy 之前执行本脚本一次，把
-- _prisma_migrations.migration_name 同步为新名，否则 Prisma 会把改名后的迁移当成未应用而重跑。
--
-- 幂等：旧名已改过则对应 UPDATE 命中 0 行，重复执行安全。全新空库无需执行本脚本。
-- 用法：psql "$DATABASE_URL" -f packages/db/prisma/reconcile-migration-rename.sql

BEGIN;

UPDATE "_prisma_migrations" SET migration_name = '00_enable_extensions' WHERE migration_name = '0_enable_extensions';
UPDATE "_prisma_migrations" SET migration_name = '01_create_business_schema' WHERE migration_name = '1_create_business_schema';
UPDATE "_prisma_migrations" SET migration_name = '02_add_idempotency_keys' WHERE migration_name = '2_add_idempotency_keys';
UPDATE "_prisma_migrations" SET migration_name = '03_support_auto_transfer' WHERE migration_name = '3_support_auto_transfer';
UPDATE "_prisma_migrations" SET migration_name = '04_auto_carry_relations_links' WHERE migration_name = '4_auto_carry_relations_links';
UPDATE "_prisma_migrations" SET migration_name = '05_quick_template_carry_links' WHERE migration_name = '5_quick_template_carry_links';
UPDATE "_prisma_migrations" SET migration_name = '06_idempotency_reserve_first' WHERE migration_name = '6_idempotency_reserve_first';
UPDATE "_prisma_migrations" SET migration_name = '07_ledger_amount_decimal_places' WHERE migration_name = '7_ledger_amount_decimal_places';
UPDATE "_prisma_migrations" SET migration_name = '08_quick_template_transfer' WHERE migration_name = '8_quick_template_transfer';
UPDATE "_prisma_migrations" SET migration_name = '09_sub_account_net_worth' WHERE migration_name = '9_sub_account_net_worth';
-- 10_sub_account_icons_and_default_meta：新旧同名，无需更新。
UPDATE "_prisma_migrations" SET migration_name = '11_item_type_icon_archive' WHERE migration_name = '10_item_type_icon_archive';
UPDATE "_prisma_migrations" SET migration_name = '12_transaction_link_kind' WHERE migration_name = '11_transaction_link_kind';
UPDATE "_prisma_migrations" SET migration_name = '13_plan_stopped_at' WHERE migration_name = '12_plan_stopped_at';
UPDATE "_prisma_migrations" SET migration_name = '14_continuous_entry' WHERE migration_name = '10_continuous_entry';
UPDATE "_prisma_migrations" SET migration_name = '15_person_sort_order' WHERE migration_name = '11_person_sort_order';
UPDATE "_prisma_migrations" SET migration_name = '16_default_bucket_net_worth' WHERE migration_name = '10_default_bucket_net_worth';
UPDATE "_prisma_migrations" SET migration_name = '17_relation_settlement_directions' WHERE migration_name = '13_relation_settlement_directions';
UPDATE "_prisma_migrations" SET migration_name = '18_lend_account_status_cleanup' WHERE migration_name = '14_lend_account_status_cleanup';
UPDATE "_prisma_migrations" SET migration_name = '19_lend_empty_account_status_cleanup' WHERE migration_name = '15_lend_empty_account_status_cleanup';
UPDATE "_prisma_migrations" SET migration_name = '20_import_jobs' WHERE migration_name = '16_import_jobs';
UPDATE "_prisma_migrations" SET migration_name = '21_account_sub_account_sort_order' WHERE migration_name = '17_account_sub_account_sort_order';
UPDATE "_prisma_migrations" SET migration_name = '22_default_sub_account_sort_order' WHERE migration_name = '18_default_sub_account_sort_order';
UPDATE "_prisma_migrations" SET migration_name = '23_materialize_default_sub_account' WHERE migration_name = '19_materialize_default_sub_account';
UPDATE "_prisma_migrations" SET migration_name = '24_insurance_payment_method' WHERE migration_name = '20_insurance_payment_method';
UPDATE "_prisma_migrations" SET migration_name = '25_item_sort_order' WHERE migration_name = '21_item_sort_order';
UPDATE "_prisma_migrations" SET migration_name = '26_insurance_sort_order' WHERE migration_name = '22_insurance_sort_order';
UPDATE "_prisma_migrations" SET migration_name = '27_insurance_type_order' WHERE migration_name = '23_insurance_type_order';
UPDATE "_prisma_migrations" SET migration_name = '28_subscriptions' WHERE migration_name = '24_subscriptions';
UPDATE "_prisma_migrations" SET migration_name = '29_sub_account_active_name_unique' WHERE migration_name = '25_sub_account_active_name_unique';
-- 30_plan_share_tokens：本次新增迁移，多数库尚未应用；已应用旧名者一并对齐。
UPDATE "_prisma_migrations" SET migration_name = '30_plan_share_tokens' WHERE migration_name = '26_plan_share_tokens';

COMMIT;
