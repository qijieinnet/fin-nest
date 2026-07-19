-- 飞书机器人接入（见 docs/FEISHU_BOT_PLAN.md）。
-- 四张表：绑定关系、会话隔离、一次性绑定码、事件去重与收件箱。
-- 均为可选功能：未配置 FEISHU_APP_ID/SECRET 时不会有写入。

-- 飞书账号 ↔ fin-nest 用户。解绑走软删（revoked_at），因此 open_id 不能建普通唯一约束，
-- 否则解绑后无法用同一飞书号重新绑定；改用部分唯一索引，见下方 feishu_bindings_open_id_active_key。
CREATE TABLE feishu_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  open_id TEXT NOT NULL,
  union_id TEXT NULL,
  -- 飞书昵称，仅用于在 Web 上认出「绑的是哪个飞书号」；P1 阶段为空，绑定流程接通后（P2）填充。
  display_name TEXT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  current_ledger_id UUID NOT NULL REFERENCES ledgers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX feishu_bindings_open_id_idx ON feishu_bindings(open_id);
CREATE INDEX feishu_bindings_user_id_idx ON feishu_bindings(user_id);

-- 同一时刻一个 open_id 只能有一条生效绑定；历史绑定以 revoked_at 非空的形式留痕。
CREATE UNIQUE INDEX feishu_bindings_open_id_active_key
  ON feishu_bindings(open_id) WHERE revoked_at IS NULL;

-- AI 会话按 (open_id, chat_id) 隔离：私聊与各群的上下文互不串味。
CREATE TABLE feishu_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  open_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX feishu_chat_sessions_open_chat_key
  ON feishu_chat_sessions(open_id, chat_id);

-- 一次性绑定码：明文只在生成时返回一次，库中只存 sha256。
CREATE TABLE feishu_bind_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feishu_bind_codes_user_id_idx ON feishu_bind_codes(user_id);

-- 事件去重 + 收件箱：handler 只落库并 ack，实际处理由异步消费者完成，
-- 因此进程重启不丢已 ack 的消息（启动时重新入队 pending 与超时 processing）。
CREATE TABLE feishu_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feishu_events_status_check
    CHECK (status IN ('pending', 'processing', 'done', 'failed'))
);

CREATE INDEX feishu_events_status_idx ON feishu_events(status, created_at);
