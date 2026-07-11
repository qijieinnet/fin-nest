-- 自动记账规则携带更多字段：可收回/需归还关联、保险、关联物品。
ALTER TABLE auto_rules
  ADD COLUMN relation_payload JSONB NULL,
  ADD COLUMN insurance_id UUID NULL REFERENCES insurances(id),
  ADD COLUMN item_id UUID NULL REFERENCES items(id);

-- 待确认记录已有 relation_payload，仅补充保险/物品关联。
ALTER TABLE auto_pending_transactions
  ADD COLUMN insurance_id UUID NULL REFERENCES insurances(id),
  ADD COLUMN item_id UUID NULL REFERENCES items(id);
