-- 保单到期提醒：提前 remind_lead_value 个 remind_lead_unit（day/week/month/year）提醒。
-- 两者同时为空表示未显式配置，前端按默认提前窗口回退。
-- remind_time 为本地 HH:mm（24 小时制），供后续邮件/推送在当天该时刻发送；为空表示未设置。

ALTER TABLE insurances ADD COLUMN remind_lead_value INTEGER NULL;
ALTER TABLE insurances ADD COLUMN remind_lead_unit TEXT NULL;
ALTER TABLE insurances ADD COLUMN remind_time TEXT NULL;

ALTER TABLE insurances
  ADD CONSTRAINT insurances_remind_lead_value_positive
  CHECK (remind_lead_value IS NULL OR remind_lead_value > 0);

ALTER TABLE insurances
  ADD CONSTRAINT insurances_remind_lead_unit_check
  CHECK (remind_lead_unit IS NULL OR remind_lead_unit IN ('day', 'week', 'month', 'year'));

ALTER TABLE insurances
  ADD CONSTRAINT insurances_remind_time_check
  CHECK (remind_time IS NULL OR remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
