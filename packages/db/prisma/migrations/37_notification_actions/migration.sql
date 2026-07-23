-- 可操作推送：卡片按钮（订阅退订/确认续订等）的抢占与结果留痕。
--
-- 关键约束：一次提醒事件会给**每个接收人各生成一行**（dedupe_key 含 open_id），
-- 但按钮动作只能执行一次——否则夫妻俩各点一次「确认续订」会推进两个计费周期。
-- 因此抢占按 occurrence_key（= dedupe_key 去掉收件人段）跨行进行：
--   UPDATE ... WHERE occurrence_key = $1 AND action_state IS NULL
-- 单条 UPDATE 天然原子，并发点击只有一方拿到 count > 0。

ALTER TABLE notifications ADD COLUMN occurrence_key TEXT NULL;

-- 已有行（如果有）从 dedupe_key 回填：去掉最后一段 open_id。
UPDATE notifications SET occurrence_key = regexp_replace(dedupe_key, ':[^:]*$', '')
 WHERE occurrence_key IS NULL;

ALTER TABLE notifications ALTER COLUMN occurrence_key SET NOT NULL;

ALTER TABLE notifications
  -- NULL = 尚未操作（按钮仍可点）；非 NULL = 已是终态，按钮不再渲染。
  ADD COLUMN action_state TEXT NULL,
  ADD COLUMN acted_by UUID NULL,
  ADD COLUMN acted_at TIMESTAMPTZ NULL;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_action_state_check
  CHECK (action_state IS NULL OR action_state IN ('renewed', 'terminated'));

-- 抢占语句的查询路径。
CREATE INDEX notifications_occurrence_idx ON notifications(occurrence_key, action_state);
