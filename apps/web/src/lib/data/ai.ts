"use client";

import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  aiChatPath,
  aiChatStreamPath,
  aiConversationPath,
  aiConversationsPath,
  aiMessageCardStatePath,
  aiMessageDraftsPath,
  aiStatusPath,
  apiRequest,
  buildApiUrl,
  getSessionToken,
  type AiCard,
  type AiChatResult,
  type AiChatStreamStart,
  type AiConversationDetail,
  type AiConversationSummary,
  type AiDraftInput,
  type AiMessage,
  type AiStatus,
} from "@/lib/api";
import { linkSignals } from "@/lib/data/ai-chat-run";
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

/** 历史会话滚动加载：每页 pageSize 条，返回不足一页即无更多。 */
export function useInfiniteAiConversations(ledgerId: string | null, pageSize = 20) {
  return useInfiniteQuery({
    // 前缀为 aiConversations(ledgerId)，聊天结束的 invalidate 会一并命中本分页查询。
    queryKey: [...queryKeys.aiConversations(ledgerId ?? "none"), "paged"],
    queryFn: ({ pageParam }) =>
      apiRequest<AiConversationSummary[]>(aiConversationsPath(ledgerId!), {
        query: { limit: pageSize, offset: pageParam },
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === pageSize ? allPages.length * pageSize : undefined,
    enabled: Boolean(ledgerId),
  });
}

export function useAiConversation(ledgerId: string | null, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiConversation(ledgerId ?? "none", conversationId ?? "none"),
    queryFn: () => apiRequest<AiConversationDetail>(aiConversationPath(ledgerId!, conversationId!)),
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
  /** 用户消息已落库：此后连接即便断开，服务端也会把本轮跑完并持久化。 */
  onStart?: (info: AiChatStreamStart) => void;
  onDelta: (text: string) => void;
  onCard: (card: AiCard) => void;
};

/** 流式读取的空闲上限：服务端心跳间隔 15 秒，连续约 3 次没收到就判定连接已死。 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

/** 等待响应头的上限：上传 + 服务端开始处理。超时视同断连，转入按 requestId 恢复。 */
const STREAM_HEADERS_TIMEOUT_MS = 90_000;
/** 非 2xx 时读取错误体的上限。 */
const ERROR_BODY_TIMEOUT_MS = 10_000;

/**
 * 服务端给出了结论的失败：HTTP 非 2xx（status 有值）或以 error 事件结束本轮（status 为空）。
 * 是否还要按 requestId 恢复由调用方按 status/code 判断（5xx、重复提交仍可能有结果）。
 */
export class AiServerError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "AiServerError";
    this.status = options.status;
    this.code = options.code;
  }
}

/**
 * 流式聊天（SSE over POST）：正文增量与卡片实时回调，结束返回与非流式同构的最终结果。
 * apiRequest 只支持 JSON 整包，这里手写 fetch + 流读取。带图时改用 multipart（字段 images），
 * content-type 交给浏览器带 boundary。收到 done/error 终态事件即停止读取：之后连接再断
 * （iOS 切 App）也不会丢掉已经拿到的结论。
 */
export async function streamAiChat(
  ledgerId: string,
  input: { conversationId?: string; content: string; images?: Blob[]; requestId?: string },
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<AiChatResult> {
  const token = getSessionToken();
  const images = input.images ?? [];
  let body: BodyInit;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (images.length > 0) {
    const form = new FormData();
    if (input.conversationId) form.append("conversationId", input.conversationId);
    if (input.requestId) form.append("requestId", input.requestId);
    form.append("content", input.content);
    images.forEach((image, index) => form.append("images", image, `bill-${index + 1}.jpg`));
    body = form;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      content: input.content,
    });
  }
  // 等响应头也要有上限（上传挂住/服务端迟迟不响应），超时按断连处理；拿到头后看门狗接手。
  const headersTimeout = new AbortController();
  const headersTimer = setTimeout(
    () => headersTimeout.abort(new Error("连接中断")),
    STREAM_HEADERS_TIMEOUT_MS,
  );
  const linked = linkSignals(signal, headersTimeout.signal);
  let response: Response;
  try {
    response = await fetch(buildApiUrl(aiChatStreamPath(ledgerId)), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body,
      signal: linked.signal,
    });
  } catch (error) {
    linked.dispose();
    throw error;
  } finally {
    clearTimeout(headersTimer);
  }
  if (!response.ok || !response.body) {
    // 错误体也可能迟迟不结束（反代 502 页面挂住）：限时读取，且仍受外部 signal（停止/卸载）约束；
    // 读不到就按 HTTP 状态处理（5xx 照样转入恢复）。
    const bodyTimer = setTimeout(
      () => headersTimeout.abort(new Error("读取错误响应超时")),
      ERROR_BODY_TIMEOUT_MS,
    );
    let message = "发送失败，请重试";
    let code: string | undefined;
    try {
      const data = (await response.json()) as { message?: string; code?: string };
      if (data?.message) message = data.message;
      code = data?.code;
    } catch {
      // 非 JSON 错误体（如反代 502 页面）、超时或被中止：用默认文案
    } finally {
      clearTimeout(bodyTimer);
      linked.dispose();
    }
    throw new AiServerError(message, { status: response.status, code });
  }

  type Terminal =
    | { kind: "done"; result: AiChatResult }
    | { kind: "error"; message: string; code?: string };
  let terminal: Terminal | null = null;
  const dispatch = (event: string, payload: string) => {
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (event === "start") handlers.onStart?.(data as AiChatStreamStart);
    else if (event === "delta") handlers.onDelta((data as { text: string }).text);
    else if (event === "card") handlers.onCard((data as { card: AiCard }).card);
    else if (event === "done") terminal = { kind: "done", result: data as AiChatResult };
    else if (event === "error") {
      const payload = data as { message?: string; code?: string };
      terminal = { kind: "error", message: payload.message ?? "AI 服务出错", code: payload.code };
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  // 空闲看门狗：服务端每 15 秒发心跳，长时间一个字节都没有说明连接已死但没报错
  // （例如中间代理的上游断了却没关下游），转入按 requestId 恢复，而不是无限期卡住。
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const readWithIdleTimeout = () =>
    new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      idleTimer = setTimeout(() => reject(new Error("连接中断")), STREAM_IDLE_TIMEOUT_MS);
      reader.read().then(resolve, reject);
    }).finally(() => {
      if (idleTimer) clearTimeout(idleTimer);
    });
  try {
    while (!terminal) {
      const { done, value } = await readWithIdleTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while (!terminal && (newlineIndex = buffer.indexOf("\n")) >= 0) {
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
  } catch (error) {
    // 已拿到终态后连接才断：以终态为准，否则按断连抛出。
    if (!terminal) throw error;
  } finally {
    reader.cancel().catch(() => undefined);
    linked.dispose();
  }
  const outcome = terminal as Terminal | null;
  if (outcome?.kind === "error") throw new AiServerError(outcome.message, { code: outcome.code });
  if (outcome?.kind === "done") return outcome.result;
  throw new Error("连接中断");
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

/**
 * 把一条更新后的消息写回会话详情缓存：草稿卡确认/作废后，即使离开 AI 页再返回（会话详情走
 * 缓存重放），恢复出的卡片也能显示为已记账/已作废，而不是过期的待确认状态。
 */
export function patchAiConversationMessage(
  queryClient: QueryClient,
  ledgerId: string,
  conversationId: string,
  message: AiMessage,
): void {
  queryClient.setQueryData<AiConversationDetail>(
    queryKeys.aiConversation(ledgerId, conversationId),
    (old) =>
      old
        ? { ...old, messages: old.messages.map((m) => (m.id === message.id ? message : m)) }
        : old,
  );
}

/**
 * 草稿卡确认入账后回写卡片状态（消息级更新，聊天页本地同步即可，不强制刷新会话）。
 * 仅作为外层编排 mutation（confirmDraft）的内层调用，错误由外层统一提示，
 * 故 suppress 全局错误 toast，避免内外两层各弹一次（双重提示）。
 */
export function useUpdateAiCardState(ledgerId: string | null) {
  return useMutation({
    meta: { suppressErrorToast: true },
    // input.ledgerId：卡片所属账本（操作发起时固定），中途切换账本也打到正确的账本上。
    mutationFn: (input: {
      messageId: string;
      cardIndex: number;
      transactionId: string;
      ledgerId?: string;
    }) =>
      apiRequest<AiMessage>(aiMessageCardStatePath(input.ledgerId ?? ledgerId!, input.messageId), {
        method: "POST",
        body: {
          cardIndex: input.cardIndex,
          status: "confirmed",
          transactionId: input.transactionId,
        },
      }),
  });
}

/**
 * 手动作废草稿卡：置为 superseded，不入账（与 AI 的 cancel_draft 同效）。
 * 同为外层 voidDraft 的内层调用，suppress 全局 toast，错误由外层统一提示。
 */
export function useVoidAiCard(ledgerId: string | null) {
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (input: { messageId: string; cardIndex: number; ledgerId?: string }) =>
      apiRequest<AiMessage>(aiMessageCardStatePath(input.ledgerId ?? ledgerId!, input.messageId), {
        method: "POST",
        body: {
          cardIndex: input.cardIndex,
          status: "superseded",
        },
      }),
  });
}

/**
 * 修改同一条消息里的若干张待确认草稿（行内编辑 / 批量设置）。服务端整体校验、全部通过才落库，
 * 返回更新后的消息。错误由调用方就地提示（如行内编辑区），故不弹全局 toast。
 */
export function useUpdateAiDrafts(ledgerId: string | null) {
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (input: {
      messageId: string;
      drafts: Array<{ cardIndex: number; draft: AiDraftInput }>;
      ledgerId?: string;
    }) =>
      apiRequest<AiMessage>(aiMessageDraftsPath(input.ledgerId ?? ledgerId!, input.messageId), {
        method: "PATCH",
        body: { drafts: input.drafts },
      }),
  });
}
