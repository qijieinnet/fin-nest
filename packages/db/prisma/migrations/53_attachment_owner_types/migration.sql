-- 附件归属类型补齐。
--
-- 01 号迁移的 CHECK 只允许 transaction / insurance / item，但代码早已支持订阅附件
-- （FilesService.assertOwner 的 subscription 分支、订阅编辑页的附件区），写库时会撞约束 500。
-- 这次顺带补上 ai_message：AI 聊天里上传的账单图片挂在用户消息上（仅会话本人可读）。
ALTER TABLE attachments
  DROP CONSTRAINT attachments_owner_type_check,
  ADD CONSTRAINT attachments_owner_type_check CHECK (
    owner_type IN ('transaction', 'insurance', 'item', 'subscription', 'ai_message')
  );
