-- 幂等键存储：金额写操作（交易、调整、结算、子账户开户等）通过 Idempotency-Key 头去重，
-- 防止客户端重试 / 重复提交产生重复流水与错误余额。

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  user_id UUID NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys(created_at);
