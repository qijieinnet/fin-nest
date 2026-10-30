-- 智能体个人 token（MCP 接入，见 docs/MCP_PLAN.md）。
-- 与 service_tokens 不同：token 绑定到具体用户，身份只由 token 本身决定，调用方不能声明「代表谁」。
-- ledger_ids 为空数组 = 该用户所在的全部账本；allowed_ips 存 CIDR 文本，由 API 校验格式。
-- 吊销而非删除（revoked_at），审计日志可回溯到具体 token。
CREATE TABLE agent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_suffix TEXT NOT NULL,
  ledger_ids UUID[] NOT NULL DEFAULT '{}',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  allowed_ips TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ(6),
  revoked_at TIMESTAMPTZ(6),
  last_used_at TIMESTAMPTZ(6),
  last_used_ip TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_tokens_token_hash_key ON agent_tokens (token_hash);
CREATE INDEX agent_tokens_user_id_created_at_idx ON agent_tokens (user_id, created_at);
