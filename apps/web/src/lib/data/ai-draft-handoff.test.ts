import { describe, expect, it } from "vitest";
import { aiCardIdempotencyKey, parseAiDraftHandoff, type AiDraftHandoff } from "./ai-draft-handoff";

const handoff: AiDraftHandoff = {
  version: 1,
  conversationId: "conversation-1",
  messageId: "message-1",
  cardIndex: 2,
  draft: {
    type: "expense",
    grossAmountMicros: "45000000",
    occurredOn: "2026-07-16",
    currency: "CNY",
    categoryId: "category-1",
  },
};

describe("AI draft handoff", () => {
  it("uses the same idempotency key as direct card confirmation", () => {
    expect(aiCardIdempotencyKey(handoff.messageId, handoff.cardIndex)).toBe("ai-card-message-1-2");
  });

  it("round-trips card identity and draft fields", () => {
    expect(parseAiDraftHandoff(JSON.stringify(handoff))).toEqual(handoff);
  });

  it("rejects legacy or malformed payloads", () => {
    expect(parseAiDraftHandoff(JSON.stringify(handoff.draft))).toBeNull();
    expect(parseAiDraftHandoff("not-json")).toBeNull();
  });
});
