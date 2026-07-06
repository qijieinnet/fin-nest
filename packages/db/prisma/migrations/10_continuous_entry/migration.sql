-- 连续记账开关：开启后新建记账提交不关闭页面，默认关闭。
ALTER TABLE "record_settings" ADD COLUMN IF NOT EXISTS "continuous_entry" boolean NOT NULL DEFAULT false;
