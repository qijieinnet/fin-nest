-- 推送渠道整合：飞书与 Web Push 合并成同一套「推送给谁」，渠道由接收人自己决定。
--
-- 改动前：reminder_targets 挂的是**飞书绑定 id**，等于让配置者去选「张三的飞书」这种端点粒度，
-- 新增一条渠道就要在每张业务表单、每个 DTO、每处 UI 再加一列同形态的多选。
-- 改动后：挂 user_id，配置者只选「推给谁」；走飞书还是 Web Push 由 users.notify_* 决定
-- （谁的手机谁做主）。发送时一个 user 展开成 N 条 notifications，每条一个渠道。
--
-- occurrence_key 不含收件人也不含渠道，因此跨渠道的动作抢占天然成立：
-- 在飞书点了「确认续订」，从 iPhone 通知点进落地页会看到「已由 XX 处理」。

-- ---------------------------------------------------------------------------
-- 1. 用户级渠道偏好。账号级（与 users.app_lock_enabled 同级），不分账本：
--    「我不想被飞书吵」是人的属性，不是某个账本的属性。
--    默认都开：老用户升级后行为不变（此前配了接收人就一定走飞书）。
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN notify_feishu BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN notify_web_push BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Web Push 订阅。**按设备**一行：同一个人的手机、平板、桌面浏览器各自一个 endpoint，
--    推送时全部投递（这正是不能把 Web Push 做成端点粒度选择项的原因——换台设备就得
--    去每个订阅档位重配一遍）。
--
--    endpoint 唯一：浏览器重新订阅可能拿到同一个 endpoint（此时密钥也可能轮换），
--    走 upsert 覆盖密钥而不是插重复行。
--
--    删号即删订阅：user_id 上做 ON DELETE CASCADE 没有意义（本项目不物理删用户），
--    但外键仍要有，避免孤儿行在推送时被反复捞起。
-- ---------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  -- 推送服务的投递地址。iOS/Safari 为 https://web.push.apple.com/...，Chrome 为 fcm.googleapis.com。
  endpoint TEXT NOT NULL UNIQUE,
  -- RFC 8291 的两把料：客户端公钥（P-256，base64url）与 16 字节 auth secret。
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- 「iPhone · Safari」这类展示名，用户在通知设置里据此认出是哪台设备。由前端 UA 推断后提交。
  device_label TEXT NULL,
  user_agent TEXT NULL,
  last_success_at TIMESTAMPTZ NULL,
  -- 连续失败次数。404/410 一次即删（订阅已失效），其余错误累计到上限再删，
  -- 避免推送服务临时抽风就把用户的订阅清掉。
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions(user_id);

-- ---------------------------------------------------------------------------
-- 3. reminder_targets 从「飞书绑定」改挂「用户」。
--
--    feishu_binding_id 直接删掉而非留一版：它 NOT NULL，留着就得先改可空，
--    那会留下一个谁都不该再写的孤儿列；数据可由 user_id + feishu_bindings 还原，
--    且整份库有系统备份兜底。
-- ---------------------------------------------------------------------------
ALTER TABLE reminder_targets ADD COLUMN user_id UUID NULL REFERENCES users(id);

UPDATE reminder_targets AS t
   SET user_id = b.user_id
  FROM feishu_bindings AS b
 WHERE b.id = t.feishu_binding_id;

-- 绑定行已不存在的孤儿目标（理论上不会有：解绑是软删，行始终在）。
DELETE FROM reminder_targets WHERE user_id IS NULL;

-- 同一个人绑过两次飞书（先解绑再绑）会在同一对象上留下两行，合并成一行。
DELETE FROM reminder_targets AS a
 USING reminder_targets AS b
 WHERE a.ctid < b.ctid
   AND a.source_type = b.source_type
   AND a.source_id = b.source_id
   AND a.user_id = b.user_id;

ALTER TABLE reminder_targets ALTER COLUMN user_id SET NOT NULL;

DROP INDEX reminder_targets_source_channel_binding_key;
CREATE UNIQUE INDEX reminder_targets_source_type_source_id_user_id_key
  ON reminder_targets(source_type, source_id, user_id);

ALTER TABLE reminder_targets DROP CONSTRAINT reminder_targets_channel_check;
ALTER TABLE reminder_targets
  DROP COLUMN channel,
  DROP COLUMN feishu_binding_id;

-- ---------------------------------------------------------------------------
-- 4. notifications 放行 webpush 渠道。
--    target_ref 的语义随渠道而变：feishu 是 open_id，webpush 是 user_id
--    （一个人的多台设备共享一条 notification，发送时才展开成多次投递——
--     否则新增一台设备就会让同一条提醒重发一遍）。
-- ---------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT notifications_channel_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('feishu', 'webpush'));

-- dedupe_key 加入渠道段（`{occurrence_key}:{channel}:{target_ref}`）。
-- 不回填的话，今天已发过的飞书提醒会因为 key 变了而再发一次。
UPDATE notifications
   SET dedupe_key = occurrence_key || ':feishu:' || target_ref
 WHERE channel = 'feishu'
   AND dedupe_key = occurrence_key || ':' || target_ref;
