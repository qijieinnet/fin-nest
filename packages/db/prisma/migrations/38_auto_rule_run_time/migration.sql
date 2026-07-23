-- 自动记账的「指定时间」与飞书推送。
--
-- run_time：当天几点生成待确认（本地 HH:mm）。为空沿用原行为——只要 next_run_on 到期，
-- worker 下一轮轮询就生成，不看时刻。设了值则当日必须过点才生成，从而让推送落在用户预期的时刻。

ALTER TABLE auto_rules ADD COLUMN run_time TEXT NULL;

-- 推送目标表接纳第二种来源。source_id 此时指向 auto_rules.id，
-- 与订阅一样挂在「规则」上而非单条待确认上：同一规则每期生成的待确认共用一批接收人。
ALTER TABLE reminder_targets DROP CONSTRAINT reminder_targets_source_type_check;
ALTER TABLE reminder_targets
  ADD CONSTRAINT reminder_targets_source_type_check
  CHECK (source_type IN ('subscription', 'auto_rule'));

-- notifications.source_type 无 CHECK 约束（见 36_notifications），新增 'auto_pending' 无需改表。
-- 但按钮动作的终态多了两种，放开 action_state 的取值。
ALTER TABLE notifications DROP CONSTRAINT notifications_action_state_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_action_state_check
  CHECK (action_state IS NULL OR action_state IN ('renewed', 'terminated', 'confirmed', 'discarded'));
