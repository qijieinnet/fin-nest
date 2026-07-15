-- 订阅到期提醒时间（本地 HH:mm，24 小时制）：配合到期提醒，供后续邮件/推送在当天该时刻发送。
-- 为空表示未设置提醒时间。

ALTER TABLE subscriptions ADD COLUMN remind_time TEXT NULL;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_remind_time_check
  CHECK (remind_time IS NULL OR remind_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
