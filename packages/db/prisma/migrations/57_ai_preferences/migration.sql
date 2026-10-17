-- AI 个人偏好（按账本 + 用户各一份，与 AI 会话一样私有）。
-- image_instructions：识别账单图片时的长期补充要求（如「美团外卖都记到餐饮-外卖」「小票按商品拆分」），
-- 只在带图的那一轮注入系统提示；长度上限由 API 校验。
CREATE TABLE ai_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  image_instructions TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_preferences_ledger_id_user_id_key ON ai_preferences (ledger_id, user_id);
