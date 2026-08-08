-- 快捷模板：关联物品时按「耗材/维修」还是「购入」入账。
--
-- transaction_links.link_kind 上早就有这个区分（consumable / purchase），它决定这笔钱算不算进
-- 物品的耗材合计：耗材要累加，购入不能——物品自己已经有「购买价格」字段，再计一次就重复了。
-- 但模板此前没有地方存这个选择，跑模板一律写死 consumable，想用模板记一笔「购入」就做不到。
--
-- 允许为空：历史模板保持原来的行为（按 consumable 处理），与交易关联的默认取值一致；
-- 只在模板确实关联了物品时才有意义。

ALTER TABLE quick_templates ADD COLUMN item_link_kind TEXT;
