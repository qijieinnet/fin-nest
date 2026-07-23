-- 通用提醒推送：推送目标 + 推送记录。
-- 首个接入方是订阅到期提醒（channel='feishu'），source_type/source_id 泛化以便保险/预算复用。
-- 未配置 FEISHU_APP_ID/SECRET 时两张表都不会有写入。

-- 推送目标。挂在业务对象（订阅）上而非单条提醒规则上：多档提醒共用同一批接收人。
CREATE TABLE reminder_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  channel TEXT NOT NULL,
  -- 不加外键到 feishu_bindings：解绑是软删，绑定行始终存在；读取时按 revoked_at IS NULL 过滤。
  feishu_binding_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_targets_source_type_check
    CHECK (source_type IN ('subscription')),
  CONSTRAINT reminder_targets_channel_check
    CHECK (channel IN ('feishu'))
);

CREATE UNIQUE INDEX reminder_targets_source_channel_binding_key
  ON reminder_targets(source_type, source_id, channel, feishu_binding_id);
CREATE INDEX reminder_targets_ledger_id_idx ON reminder_targets(ledger_id);

-- 推送记录，同时充当幂等闸门：调度器先插 pending 抢占 dedupe_key，
-- 唯一冲突即「已排或已发」直接跳过，插入成功才调飞书接口。
-- dedupe_key 形如 subscription:{id}:{续费日}:{提前量}:{open_id}——提前量段是为多档提醒预留的，
-- 现在恒为单档（如 3d），扩展到多档时不需要改结构。
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  channel TEXT NOT NULL,
  -- 渠道内的收件标识，飞书为 open_id。
  target_ref TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_status_check
    CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT notifications_channel_check
    CHECK (channel IN ('feishu'))
);

-- 派发扫描的唯一查询路径：status='pending' AND scheduled_at <= now()。
CREATE INDEX notifications_status_scheduled_idx ON notifications(status, scheduled_at);
CREATE INDEX notifications_source_idx ON notifications(source_type, source_id);
