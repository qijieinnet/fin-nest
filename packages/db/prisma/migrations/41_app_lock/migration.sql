-- 应用锁（打开应用时验证身份）从设备级 localStorage 迁到账号级数据库：
-- 开关存 users.app_lock_enabled，WebAuthn 凭证存 app_lock_credentials（服务端验签）。
--
-- 一个用户可以有多把凭证（每台设备/每个浏览器注册一把，iCloud 钥匙串内的 passkey 亦可跨端复用），
-- 解锁时后端把全部 credential_id 作为 allowCredentials 下发，系统自动挑一把本机可用的。
--
-- 注意：旧版凭证只在浏览器 localStorage 存了 credential_id、服务端没有公钥，无法验签，
-- 因此本次上线后所有用户需要重新开启开关并重新注册一次 Face ID / Touch ID。

ALTER TABLE users ADD COLUMN app_lock_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE app_lock_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  -- PublicKeyCredential.id（base64url）
  credential_id TEXT NOT NULL UNIQUE,
  -- COSE 格式公钥原文
  public_key BYTEA NOT NULL,
  -- 认证器自增计数器，防重放；Apple 平台认证器恒为 0
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_name TEXT NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_lock_credentials_user_id_idx ON app_lock_credentials(user_id);
