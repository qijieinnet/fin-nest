import type { AiDraftFields } from "@/lib/api";

export const AI_DRAFT_SEED_KEY = "fin-nest.ai-draft-seed";

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
