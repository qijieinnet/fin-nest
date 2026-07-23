-- 记账提醒：按周期提醒「今天该记账了」，一个账本一条配置。
--
-- 与订阅/保单的到期提醒不同，这里没有「基准日 + 提前量」，而是重复周期，
-- 所以不复用 reminder_schedules，单开一张与 record_settings 同形态（ledger_id 主键）的表。

CREATE TABLE entry_reminders (
  ledger_id UUID PRIMARY KEY REFERENCES ledgers(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- daily | weekly | monthly
  frequency TEXT NOT NULL DEFAULT 'daily',
  -- 每周提醒的星期，ISO 口径 1=周一 … 7=周日。frequency='weekly' 时生效。
  weekdays SMALLINT[] NOT NULL DEFAULT '{}',
  -- 每月提醒的日号 1..31。当月没有该日（如 31 号遇到 30 天的月份）时落到当月最后一天。
  month_days SMALLINT[] NOT NULL DEFAULT '{}',
  -- 本地 HH:mm（24 小时制），与订阅/保单的 remind_time 同口径。
  remind_time TEXT NOT NULL DEFAULT '20:00',
  updated_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entry_reminders_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT entry_reminders_remind_time_check
    CHECK (remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- 接收人复用 reminder_targets，source_id 指向账本（记账提醒一个账本只有一条，没有独立主键）。
ALTER TABLE reminder_targets DROP CONSTRAINT reminder_targets_source_type_check;
ALTER TABLE reminder_targets
  ADD CONSTRAINT reminder_targets_source_type_check
  CHECK (source_type IN ('auto_rule', 'reminder_schedule', 'entry_reminder'));
