import type { AiDraftFields } from "@/lib/api";

export const AI_DRAFT_SEED_KEY = "fin-nest.ai-draft-seed";

/**
 * 当前活跃会话 id 持久化键：离开 AI 页去记一笔/编辑再返回时恢复同一会话，
 * 避免回到空白新对话。仅本会话级（sessionStorage），新建对话时清除。
 */
export const AI_ACTIVE_CONVERSATION_KEY = "fin-nest.ai-active-conversation";

export type AiDraftHandoff = {
  version: 1;
  conversationId: string;
  messageId: string;
  cardIndex: number;
  draft: AiDraftFields;
};

export function aiCardIdempotencyKey(messageId: string, cardIndex: number): string {
  return `ai-card-${messageId}-${cardIndex}`;
}

export function parseAiDraftHandoff(raw: string): AiDraftHandoff | null {
  try {
    const value = JSON.parse(raw) as Partial<AiDraftHandoff>;
    if (
      value.version !== 1 ||
      typeof value.conversationId !== "string" ||
      typeof value.messageId !== "string" ||
      !Number.isInteger(value.cardIndex) ||
      (value.cardIndex ?? -1) < 0 ||
      !value.draft ||
      typeof value.draft !== "object"
    ) {
      return null;
    }
    return value as AiDraftHandoff;
  } catch {
    return null;
  }
}
