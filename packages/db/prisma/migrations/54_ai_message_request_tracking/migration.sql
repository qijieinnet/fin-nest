-- AI 聊天轮次追踪：支撑「断连不中止 + 前端按 requestId 恢复」。
--
-- iOS Safari 切到别的 App 会掐断页面上的流式请求，服务端照常跑完本轮；前端回来后
-- 按客户端生成的 request_id 查轮次状态，并按 reply_to_id 精确找到这一轮的助手回复
-- （不能用「用户消息之后的任意助手消息」判断，旧轮次的迟到回复会被认错）。
-- failed：本轮出错时也落一条助手消息（正文是给用户看的错误说明），让恢复有确定终态；
-- 这类消息不回放给模型。
ALTER TABLE ai_messages
  ADD COLUMN request_id TEXT,
  ADD COLUMN reply_to_id UUID,
  ADD COLUMN failed BOOLEAN NOT NULL DEFAULT FALSE;

-- 同一 request_id 只能落一条用户消息：重复提交（重试/双击）直接撞约束拒绝，不会重复跑一轮。
CREATE UNIQUE INDEX ai_messages_request_id_key ON ai_messages (request_id);
CREATE INDEX ai_messages_reply_to_id_idx ON ai_messages (reply_to_id);
