-- 到期提醒改为多档：订阅 / 保单可配多条提醒，每档有独立的提前量、提醒时刻与飞书接收人。
--
-- 档位是独立实体（有自己的接收人），所以单独建表而不是塞 JSON：
-- reminder_targets 已经是 (source_type, source_id) 泛化的，接收人改挂到 source_type='reminder_schedule'
-- 即可复用同一套读写与成员校验，不需要给它加可空外键、也不用改唯一约束。
--
-- subscriptions/insurances 上原有的 remind_lead_value/remind_lead_unit/remind_time **保留**，
-- 由 API 写成「最早那一档」的镜像：前端的「即将到期」标签、红点汇总、自动确认续费的匹配窗口
-- 都读它，档位表是唯一事实来源，这三列只是派生缓存（也让 JSON 备份继续带得走单档配置）。

CREATE TABLE reminder_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  -- subscription | insurance
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  lead_value INTEGER NOT NULL,
  -- day | week | month | year
  lead_unit TEXT NOT NULL,
  -- 本地 HH:mm（24 小时制），与 subscriptions.remind_time 同口径。
  remind_time TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_schedules_source_type_check
    CHECK (source_type IN ('subscription', 'insurance')),
  CONSTRAINT reminder_schedules_lead_value_positive
    CHECK (lead_value > 0),
  CONSTRAINT reminder_schedules_lead_unit_check
    CHECK (lead_unit IN ('day', 'week', 'month', 'year')),
  CONSTRAINT reminder_schedules_remind_time_check
    CHECK (remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- 同一对象不允许两档相同提前量：它们会算出同一个 notifications.dedupe_key，
-- 第二档会被唯一约束静默吞掉（表现为「配了却不发」）。
CREATE UNIQUE INDEX reminder_schedules_source_lead_key
  ON reminder_schedules(source_type, source_id, lead_value, lead_unit);
CREATE INDEX reminder_schedules_source_idx ON reminder_schedules(source_type, source_id);
CREATE INDEX reminder_schedules_ledger_id_idx ON reminder_schedules(ledger_id);

-- 回填：已开启提醒的订阅/保单各生成一档。remind_time 为空的按 09:00 补齐
-- （旧版允许只配提前量不配时刻，多档模型里时刻是必填的）。
INSERT INTO reminder_schedules (ledger_id, source_type, source_id, lead_value, lead_unit, remind_time)
SELECT ledger_id, 'subscription', id, remind_lead_value, remind_lead_unit, COALESCE(remind_time, '09:00')
  FROM subscriptions
 WHERE deleted_at IS NULL AND remind_lead_value IS NOT NULL AND remind_lead_unit IS NOT NULL;

INSERT INTO reminder_schedules (ledger_id, source_type, source_id, lead_value, lead_unit, remind_time)
SELECT ledger_id, 'insurance', id, remind_lead_value, remind_lead_unit, COALESCE(remind_time, '09:00')
  FROM insurances
 WHERE deleted_at IS NULL AND remind_lead_value IS NOT NULL AND remind_lead_unit IS NOT NULL;

-- 接收人从「订阅/保单」改挂到「档位」。auto_rule 的目标不动。
--
-- 顺序要紧，且**必须先把约束整个去掉**再搬数据：搬迁过程中新旧两种 source_type 会同时存在，
-- 无论先装新约束（存量的 'subscription' 行过不了）还是留着旧约束（新写的 'reminder_schedule'
-- 过不了），都会让整条迁移回滚。
ALTER TABLE reminder_targets DROP CONSTRAINT reminder_targets_source_type_check;

UPDATE reminder_targets AS t
   SET source_type = 'reminder_schedule', source_id = s.id
  FROM reminder_schedules AS s
 WHERE t.source_type = s.source_type AND t.source_id = s.source_id;

-- 关掉提醒时接收人本应一并清空，理论上不会有剩余；真有（历史数据不一致）也只能是
-- 指向已不存在档位的孤儿行，留着会让 CHECK 约束加不上。
DELETE FROM reminder_targets WHERE source_type IN ('subscription', 'insurance');

ALTER TABLE reminder_targets
  ADD CONSTRAINT reminder_targets_source_type_check
  CHECK (source_type IN ('auto_rule', 'reminder_schedule'));

-- 保单提醒卡新增「已处理」按钮：点了就抑制同一周期后续档位的推送。
ALTER TABLE notifications DROP CONSTRAINT notifications_action_state_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_action_state_check
  CHECK (
    action_state IS NULL
    OR action_state IN ('renewed', 'terminated', 'confirmed', 'discarded', 'acknowledged')
  );

-- 后续档位的抑制判定：按 source 捞出「本对象已被处理过的提醒周期」。
CREATE INDEX notifications_source_action_idx
  ON notifications(source_type, source_id, action_state);
