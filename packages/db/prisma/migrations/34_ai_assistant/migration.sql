-- AI 助手：会话与消息。会话按创建者私有（同账本其他成员不可见）；
-- 消息只存对话可见内容（user/assistant），工具调用中间态不落库；
-- assistant 消息的 cards 存结构化卡片（记账草稿/查询结果），草稿确认后回写状态。

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX ai_conversations_ledger_user_idx ON ai_conversations(ledger_id, user_id, updated_at);

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  cards JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX ai_messages_conversation_idx ON ai_messages(conversation_id, created_at);
