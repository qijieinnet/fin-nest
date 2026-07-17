"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aiChatPath,
  aiChatStreamPath,
  aiConversationPath,
  aiConversationsPath,
  aiMessageCardStatePath,
  aiStatusPath,
  apiRequest,
  buildApiUrl,
  getSessionToken,
  type AiCard,
  type AiChatResult,
  type AiConversationDetail,
  type AiConversationSummary,
  type AiMessage,
  type AiStatus,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";

/** AI 是否启用由服务端环境变量决定，会话内基本不变，长缓存减少请求。 */
export function useAiStatus(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiStatus(ledgerId ?? "none"),
    queryFn: () => apiRequest<AiStatus>(aiStatusPath(ledgerId!)),
    enabled: Boolean(ledgerId),
    staleTime: 5 * 60_000,
  });
}

export function useAiConversations(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiConversations(ledgerId ?? "none"),
    queryFn: () => apiRequest<AiConversationSummary[]>(aiConversationsPath(ledgerId!)),
    enabled: Boolean(ledgerId),
  });
}

export function useAiConversation(ledgerId: string | null, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiConversation(ledgerId ?? "none", conversationId ?? "none"),
    queryFn: () =>
      apiRequest<AiConversationDetail>(aiConversationPath(ledgerId!, conversationId!)),
    enabled: Boolean(ledgerId && conversationId),
  });
}

export function useAiChat(ledgerId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId?: string; content: string }) =>
      apiRequest<AiChatResult>(aiChatPath(ledgerId!), { method: "POST", body: input }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversations(ledgerId ?? "none"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversation(ledgerId ?? "none", result.conversationId),
      });
    },
  });
}

export type AiStreamHandlers = {
  onDelta: (text: string) => void;
  onCard: (card: AiCard) => void;
};

/**
 * 流式聊天（SSE over POST）：正文增量与卡片实时回调，结束返回与非流式同构的最终结果。
 * apiRequest 只支持 JSON 整包，这里手写 fetch + 流读取。
 */
export async function streamAiChat(
  ledgerId: string,
  input: { conversationId?: string; content: string },
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<AiChatResult> {
  const token = getSessionToken();
  const response = await fetch(buildApiUrl(aiChatStreamPath(ledgerId)), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = "发送失败，请重试";
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // 非 JSON 错误体，用默认文案
    }
    throw new Error(message);
  }

  let result: AiChatResult | null = null;
  let upstreamError: string | null = null;
  const dispatch = (event: string, payload: string) => {
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (event === "delta") handlers.onDelta((data as { text: string }).text);
    else if (event === "card") handlers.onCard((data as { card: AiCard }).card);
    else if (event === "done") result = data as AiChatResult;
    else if (event === "error") upstreamError = (data as { message?: string }).message ?? "AI 服务出错";
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dispatch(eventName, line.slice(5).trim());
        eventName = "message";
      }
    }
  }
  if (upstreamError) throw new Error(upstreamError);
  if (!result) throw new Error("连接中断，请重试");
  return result;
}

export function useDeleteAiConversation(ledgerId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiRequest<{ ok: boolean }>(aiConversationPath(ledgerId!, conversationId), {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversations(ledgerId ?? "none"),
      });
    },
  });
}

/** 草稿卡确认入账后回写卡片状态（消息级更新，聊天页本地同步即可，不强制刷新会话）。 */
export function useUpdateAiCardState(ledgerId: string | null) {
  return useMutation({
    mutationFn: (input: {
      messageId: string;
      cardIndex: number;
      transactionId: string;
    }) =>
      apiRequest<AiMessage>(aiMessageCardStatePath(ledgerId!, input.messageId), {
        method: "POST",
        body: { cardIndex: input.cardIndex, status: "confirmed", transactionId: input.transactionId },
      }),
  });
}
