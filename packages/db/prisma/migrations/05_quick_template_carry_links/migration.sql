-- 快速记账模板携带保险 / 关联物品（relation_payload 已存在，用于可收回/需归还）。
ALTER TABLE quick_templates
  ADD COLUMN insurance_id UUID NULL REFERENCES insurances(id),
  ADD COLUMN item_id UUID NULL REFERENCES items(id);
