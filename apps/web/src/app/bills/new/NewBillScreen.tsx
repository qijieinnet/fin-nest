"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  aiMessageCardStatePath,
  apiRequest,
  type AiMessage,
  type TransactionDetail,
} from "@/lib/api";
import {
  AI_DRAFT_SEED_KEY,
  aiCardIdempotencyKey,
  parseAiDraftHandoff,
  type AiDraftHandoff,
} from "@/lib/data/ai-draft-handoff";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useToast } from "@/providers";
import { NewBillFormScreen } from "../_components/NewBillFormScreen";

export function NewBillScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();
  const params = useSearchParams();
  const templateId = params.get("template");
  const fromAiDraft = params.get("aiDraft") === "1";
  // AI 草稿卡「去编辑」经 sessionStorage 传 seed；undefined = 读取中，避免表单先空白挂载再重挂载。
  const [handoff, setHandoff] = useState<AiDraftHandoff | null | undefined>(
    fromAiDraft ? undefined : null,
  );

  useEffect(() => {
    if (!fromAiDraft) return;
    try {
      const raw = sessionStorage.getItem(AI_DRAFT_SEED_KEY);
      if (raw) {
        sessionStorage.removeItem(AI_DRAFT_SEED_KEY);
        setHandoff(parseAiDraftHandoff(raw));
        return;
      }
    } catch {
      // 解析失败按无 seed 处理
    }
    // StrictMode 下 effect 双跑：第二次 key 已被消费，保留首次读到的 seed。
    setHandoff((prev) => (prev === undefined ? null : prev));
  }, [fromAiDraft]);

  async function handleAiSaved(transaction: TransactionDetail) {
    if (!handoff || !ledgerId) {
      router.back();
      return;
    }
    try {
      await apiRequest<AiMessage>(aiMessageCardStatePath(ledgerId, handoff.messageId), {
        method: "POST",
        body: {
          cardIndex: handoff.cardIndex,
          status: "confirmed",
          transactionId: transaction.id,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversation(ledgerId, handoff.conversationId),
      });
    } catch {
      // 交易和直接确认共用同一个幂等键，即使状态回写暂时失败也不会重复入账。
      showToast({ tone: "error", message: "交易已保存，但 AI 卡片状态同步失败" });
    } finally {
      router.back();
    }
  }

  if (handoff === undefined) return null;
  return (
    <NewBillFormScreen
      completeAfterSave={Boolean(handoff)}
      idempotencyKeyOverride={
        handoff ? aiCardIdempotencyKey(handoff.messageId, handoff.cardIndex) : undefined
      }
      initialSeed={handoff?.draft ?? null}
      onSaved={handoff ? handleAiSaved : undefined}
      templateId={templateId}
    />
  );
}
