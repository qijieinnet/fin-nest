-- 智能体起草的交易进「待确认」（MCP P2，见 docs/MCP_PLAN.md §4）。
--
-- 待确认原本只由自动记账规则生成；现在多一个来源 source='agent'，由外部智能体经 MCP 起草，
-- 用户在待确认页（或推送卡片）确认后才入账，确认路径与规则生成的完全相同。
-- - auto_rule_id 改可空：智能体草稿不属于任何规则，check 保证两种来源各自的必填项；
-- - agent_token_id 指向起草它的 token（账本备份恢复到别处时置空），source_label 存 token 名称快照，
--   token 改名/吊销/找不到后待确认页仍能显示「来自智能体「xxx」」；
-- - 智能体的幂等键存在 period_key，按 (agent_token_id, period_key) 部分唯一：
--   同一个 token 重试同一笔只会得到同一条草稿；
-- - item_link_kind 与快捷模板同义：智能体能区分「买了这件物品」与「给它买耗材」。
ALTER TABLE auto_pending_transactions ALTER COLUMN auto_rule_id DROP NOT NULL;

ALTER TABLE auto_pending_transactions
  ADD COLUMN source TEXT NOT NULL DEFAULT 'auto_rule',
  ADD COLUMN agent_token_id UUID REFERENCES agent_tokens(id),
  ADD COLUMN source_label TEXT,
  ADD COLUMN item_link_kind TEXT,
  ADD CONSTRAINT auto_pending_transactions_source_check CHECK (
    (source = 'auto_rule' AND auto_rule_id IS NOT NULL)
    OR (source = 'agent' AND auto_rule_id IS NULL)
  ),
  ADD CONSTRAINT auto_pending_transactions_item_link_kind_check
    CHECK (item_link_kind IS NULL OR item_link_kind IN ('consumable', 'purchase'));

CREATE UNIQUE INDEX auto_pending_transactions_agent_period_key
  ON auto_pending_transactions (agent_token_id, period_key)
  WHERE source = 'agent';

-- 智能体草稿确认后生成的交易记来源 agent（详情页显示「智能体」），与规则生成的 auto 区分。
ALTER TABLE transactions
  DROP CONSTRAINT transactions_source_check,
  ADD CONSTRAINT transactions_source_check
    CHECK (source IN ('manual', 'quick', 'auto', 'import', 'ai', 'agent'));
