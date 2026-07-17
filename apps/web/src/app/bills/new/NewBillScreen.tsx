"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AI_DRAFT_SEED_KEY } from "@/app/ai/AiScreen";
import { NewBillFormScreen } from "../_components/NewBillFormScreen";
import type { TransactionSeed } from "../_components/TransactionForm";

export function NewBillScreen() {
  const params = useSearchParams();
  const templateId = params.get("template");
  const fromAiDraft = params.get("aiDraft") === "1";
  // AI 草稿卡「去编辑」经 sessionStorage 传 seed；undefined = 读取中，避免表单先空白挂载再重挂载。
  const [aiSeed, setAiSeed] = useState<TransactionSeed | null | undefined>(
    fromAiDraft ? undefined : null,
  );

  useEffect(() => {
    if (!fromAiDraft) return;
    try {
      const raw = sessionStorage.getItem(AI_DRAFT_SEED_KEY);
      if (raw) {
        sessionStorage.removeItem(AI_DRAFT_SEED_KEY);
        setAiSeed(JSON.parse(raw) as TransactionSeed);
        return;
      }
    } catch {
      // 解析失败按无 seed 处理
    }
    // StrictMode 下 effect 双跑：第二次 key 已被消费，保留首次读到的 seed。
    setAiSeed((prev) => (prev === undefined ? null : prev));
  }, [fromAiDraft]);

  if (aiSeed === undefined) return null;
  return <NewBillFormScreen initialSeed={aiSeed} templateId={templateId} />;
}
