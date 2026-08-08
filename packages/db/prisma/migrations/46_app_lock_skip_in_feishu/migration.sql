-- 应用锁：飞书客户端内是否跳过「打开应用时验证身份」。
--
-- 默认 true（跳过）：能在飞书里打开这个页面，说明已经过了飞书自己的登录态与设备锁，
-- 再让用户刷一次脸或输一次密码属于重复验证。想要双重保险的用户可以在系统设置里关掉。
--
-- 只在 users.app_lock_enabled 为真时起作用；总开关关着时这一列没有任何影响。

ALTER TABLE users ADD COLUMN app_lock_skip_in_feishu BOOLEAN NOT NULL DEFAULT true;
