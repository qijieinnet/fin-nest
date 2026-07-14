-- 订阅到期提醒：提前 remind_lead_value 个 remind_lead_unit（day/week/month/year）提醒。
-- 两者同时为空表示未显式配置，前端按计费周期回退到默认提前窗口。

ALTER TABLE subscriptions ADD COLUMN remind_lead_value INTEGER NULL;
ALTER TABLE subscriptions ADD COLUMN remind_lead_unit TEXT NULL;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_remind_lead_value_positive
  CHECK (remind_lead_value IS NULL OR remind_lead_value > 0);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_remind_lead_unit_check
  CHECK (remind_lead_unit IS NULL OR remind_lead_unit IN ('day', 'week', 'month', 'year'));
