-- 智能体变更申请（MCP P3，见 docs/MCP_PLAN.md §6）。
--
-- 已入账交易的修改/删除、账户余额调整同样「动钱」，但待确认表承载不了：它们改的是已存在的数据。
-- 智能体只能提交申请，用户在应用里看过前后对比、点「批准」才执行；批准时在同一个数据库事务里
-- 抢占状态 + 核对版本 + 执行业务，三者一起提交或一起回滚。
-- - target_id 不设外键：目标是交易或账户（kind 决定），账本恢复会重建它们的 id，申请随之作废清理；
-- - target_version：交易为申请时的 updated_at，余额调整为申请时的余额——批准时不一致就拒绝执行，
--   免得用户批准的是一份过期的前后对比；
-- - payload 是批准时原样交给领域 service 的输入，summary 是给人看的前后对比（申请时生成的快照）；
-- - 幂等键按 token 部分唯一，同一个 token 重试同一个申请只会得到同一条。
CREATE TABLE agent_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  agent_token_id UUID REFERENCES agent_tokens(id),
  source_label TEXT,
  requested_by UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  summary JSONB NOT NULL,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  result_id UUID,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT agent_change_requests_kind_check
    CHECK (kind IN ('transaction.update', 'transaction.delete', 'account.adjust')),
  CONSTRAINT agent_change_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'failed'))
);

CREATE UNIQUE INDEX agent_change_requests_agent_token_id_idempotency_key_key
  ON agent_change_requests (agent_token_id, idempotency_key)
  WHERE agent_token_id IS NOT NULL;
CREATE INDEX agent_change_requests_ledger_id_status_created_at_idx
  ON agent_change_requests (ledger_id, status, created_at);
