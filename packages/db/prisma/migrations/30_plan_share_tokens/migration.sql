-- 计划分享 token：绑定到单个计划，凭不透明 token 免登录读取「本期」卡片统计。
-- 仅存 token 的 sha256 哈希（对齐 service_tokens），永久有效、可吊销。

CREATE TABLE plan_share_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES plans(id),
  ledger_id   UUID NOT NULL REFERENCES ledgers(id),
  token_hash  TEXT NOT NULL UNIQUE,
  revoked_at  TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX plan_share_tokens_plan_idx ON plan_share_tokens(plan_id);
