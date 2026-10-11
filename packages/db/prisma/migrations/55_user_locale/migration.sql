-- 界面语言偏好（账号级）：null 表示用户从未手动选择，前端跟随设备语言；
-- 选过之后存这里，换设备/浏览器登录自动恢复。取值由 API 校验（zh-CN / en）。
ALTER TABLE users ADD COLUMN locale TEXT;
