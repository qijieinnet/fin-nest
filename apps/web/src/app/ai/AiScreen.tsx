"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, History, Plus, Send, Sparkles, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/business";
import { BottomSheet, IconButton, MobileAppShell, NavigationBar } from "@/components/ui";
import {
  aiConversationsPath,
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type AiCard,
  type AiConversationSummary,
  type AiDraftFields,
  type AiMessage,
  type TransactionDetail,
  type TransactionInput,
} from "@/lib/api";
import {
  streamAiChat,
  useAiConversation,
  useAiConversations,
  useAiStatus,
  useDeleteAiConversation,
  useUpdateAiCardState,
} from "@/lib/data/ai";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useToast } from "@/providers";
import { StatsMonthCard, TransactionDraftCard, TransactionsCard } from "./_components/AiCards";

const SUGGESTIONS = ["昨天午饭花了 45", "这个月吃饭花了多少钱？", "看看上个月的收支统计"];

/** 「去编辑」经 sessionStorage 把草稿交给记一笔表单（见 NewBillScreen）。 */
export const AI_DRAFT_SEED_KEY = "fin-nest.ai-draft-seed";

function draftToTransactionInput(draft: Extract<AiCard, { kind: "transaction_draft" }>["draft"]): TransactionInput {
  return {
    type: draft.type,
    grossAmountMicros: draft.grossAmountMicros,
    occurredOn: draft.occurredOn,
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(draft.subcategoryId ? { subcategoryId: draft.subcategoryId } : {}),
    ...(draft.personId ? { personId: draft.personId } : {}),
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    ...(draft.subAccountId ? { subAccountId: draft.subAccountId } : {}),
    ...(draft.fromAccountId ? { fromAccountId: draft.fromAccountId } : {}),
    ...(draft.fromSubAccountId ? { fromSubAccountId: draft.fromSubAccountId } : {}),
    ...(draft.toAccountId ? { toAccountId: draft.toAccountId } : {}),
    ...(draft.toSubAccountId ? { toSubAccountId: draft.toSubAccountId } : {}),
    ...(draft.note ? { note: draft.note } : {}),
  };
}

export function AiScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { currentLedger } = useLedger();
  const ledgerId = currentLedger?.id ?? null;

  const aiStatusQuery = useAiStatus(ledgerId);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // 正在确认的草稿卡（"messageId:cardIndex"），用于按钮 loading 态与防连点。
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const conversationQuery = useAiConversation(ledgerId, conversationId);
  const conversationsQuery = useAiConversations(historyOpen ? ledgerId : null);
  const deleteConversation = useDeleteAiConversation(ledgerId);
  const updateCardState = useUpdateAiCardState(ledgerId);
  // 流式进行中的助手消息（未持久化）：delta 增量拼正文、card 事件实时追加；done 后替换为持久化消息。
  const [streaming, setStreaming] = useState<{ content: string; cards: AiCard[] } | null>(null);
  const sending = streaming !== null;

  // 只在切换到「另一个」会话时才从服务端整体加载消息：done 后的 refetch / 窗口聚焦刷新
  // 若无条件覆盖本地列表，会因本地临时 id 被替换导致整屏重挂载（视觉上像刷新）。
  const loadedConversationRef = useRef<string | null>(null);
  const conversationData = conversationQuery.data;
  useEffect(() => {
    if (!conversationData) return;
    if (loadedConversationRef.current === conversationData.conversation.id) return;
    loadedConversationRef.current = conversationData.conversation.id;
    setMessages(conversationData.messages);
  }, [conversationData]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  const confirmDraft = useMutation({
    mutationFn: async ({ message, cardIndex }: { message: AiMessage; cardIndex: number }) => {
      const card = message.cards?.[cardIndex];
      if (!card || card.kind !== "transaction_draft") throw new Error("卡片不存在");
      const transaction = await apiRequest<TransactionDetail>(
        ledgerApiPath(ledgerId!, "/transactions"),
        {
          method: "POST",
          body: draftToTransactionInput(card.draft),
          // 幂等键与卡片一一对应：重复点击/失败重试不会重复入账。
          headers: { "idempotency-key": `ai-card-${message.id}-${cardIndex}` },
        },
      );
      return updateCardState.mutateAsync({
        messageId: message.id,
        cardIndex,
        transactionId: transaction.id,
      });
    },
    onSuccess: async (updatedMessage) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
      );
      showToast({ tone: "success", message: "已入账" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "stats"] }),
      ]);
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "入账失败，请重试") });
    },
    onSettled: () => setConfirmingKey(null),
  });

  const abortRef = useRef<AbortController | null>(null);
  const handleStop = () => abortRef.current?.abort();

  const handleSend = (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || sending || !ledgerId) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        cards: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setStreaming({ content: "", cards: [] });
    const abort = new AbortController();
    abortRef.current = abort;
    void (async () => {
      try {
        const result = await streamAiChat(
          ledgerId,
          { ...(conversationId ? { conversationId } : {}), content },
          {
            onDelta: (text) =>
              setStreaming((prev) => ({
                content: (prev?.content ?? "") + text,
                cards: prev?.cards ?? [],
              })),
            onCard: (card) =>
              setStreaming((prev) => ({
                content: prev?.content ?? "",
                cards: [...(prev?.cards ?? []), card],
              })),
          },
          abort.signal,
        );
        setMessages((prev) => [...prev, result.message]);
        if (!conversationId) {
          // 先记录 loadedRef 再设 id：随后的详情请求返回时不整体覆盖本地消息（防「刷新感」）。
          loadedConversationRef.current = result.conversationId;
          setConversationId(result.conversationId);
        }
        void queryClient.invalidateQueries({
          queryKey: queryKeys.aiConversations(ledgerId),
        });
      } catch (error) {
        if (abort.signal.aborted) {
          // 主动停止：服务端会把已生成部分照常持久化，稍等后从服务端恢复该会话，
          // 使卡片拿到真实 messageId 可以确认；首条消息即停止时从列表取最新会话。
          setTimeout(() => {
            loadedConversationRef.current = null;
            if (conversationId) {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.aiConversation(ledgerId, conversationId),
              });
            } else {
              void (async () => {
                try {
                  const list = await apiRequest<AiConversationSummary[]>(
                    aiConversationsPath(ledgerId),
                  );
                  if (list[0]) setConversationId(list[0].id);
                } catch {
                  // 恢复失败不打扰用户，重进会话可见
                }
              })();
            }
            void queryClient.invalidateQueries({
              queryKey: queryKeys.aiConversations(ledgerId),
            });
          }, 400);
        } else {
          showToast({
            tone: "error",
            message: error instanceof Error ? error.message : "发送失败，请重试",
          });
        }
      } finally {
        abortRef.current = null;
        setStreaming(null);
      }
    })();
  };

  const handleEdit = (draft: AiDraftFields) => {
    // 只带 id/金额/日期/备注等表单字段，冗余的 *Name 字段不进 seed。
    const seed = {
      type: draft.type,
      occurredOn: draft.occurredOn,
      grossAmountMicros: draft.grossAmountMicros,
      categoryId: draft.categoryId ?? null,
      subcategoryId: draft.subcategoryId ?? null,
      personId: draft.personId ?? null,
      accountId: draft.accountId ?? null,
      subAccountId: draft.subAccountId ?? null,
      fromAccountId: draft.fromAccountId ?? null,
      fromSubAccountId: draft.fromSubAccountId ?? null,
      toAccountId: draft.toAccountId ?? null,
      toSubAccountId: draft.toSubAccountId ?? null,
      note: draft.note ?? null,
    };
    try {
      sessionStorage.setItem(AI_DRAFT_SEED_KEY, JSON.stringify(seed));
    } catch {
      showToast({ tone: "error", message: "打开编辑失败，请重试" });
      return;
    }
    router.push(`${routes.billNew}?aiDraft=1`);
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setHistoryOpen(false);
  };

  const aiEnabled = aiStatusQuery.data?.enabled === true;
  const loadingConversation = Boolean(conversationId) && conversationQuery.isPending;

  return (
    <MobileAppShell>
      <main className="flex h-dvh flex-col px-[var(--space-page-x)]">
        <NavigationBar
          action={
            <div className="flex items-center gap-1">
              <IconButton
                icon={<History size={20} />}
                label="历史会话"
                onClick={() => setHistoryOpen(true)}
              />
              <IconButton icon={<Plus size={20} />} label="新对话" onClick={startNewConversation} />
            </div>
          }
          leading={
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={() => router.back()}
            />
          }
          title="AI 助手"
          variant="inline"
        />

        <div className="flex-1 overflow-y-auto pb-4">
          {aiStatusQuery.isPending ? (
            <LoadingState rows={2} title="加载中" />
          ) : !aiEnabled ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Sparkles className="text-[var(--color-text-muted)]" size={28} />
              <p className="font-semibold text-[var(--color-text-primary)]">AI 助手未启用</p>
              <p className="max-w-[280px] text-sm text-[var(--color-text-muted)]">
                在服务端配置 AI_BASE_URL / AI_API_KEY / AI_MODEL 后即可使用自然语言记账与查询。
              </p>
            </div>
          ) : loadingConversation ? (
            <LoadingState rows={3} title="加载会话" />
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Sparkles className="text-[var(--color-tint-strong)]" size={30} />
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">
                  用一句话记账或查账
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  记账草稿需要你确认后才会入账
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    className="rounded-full border border-black/[0.08] bg-[var(--color-bg-surface)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-2">
              {messages.map((message) => (
                <div className="flex flex-col gap-2" key={message.id}>
                  {/* 有卡片时正文不展示（模型正文只是卡片的复述），避免信息重复。 */}
                  {message.content &&
                  !(message.role === "assistant" && (message.cards?.length ?? 0) > 0) ? (
                    <div
                      className={
                        message.role === "user"
                          ? "self-end max-w-[85%] rounded-[18px] rounded-br-[6px] bg-[var(--color-tint-strong)] px-4 py-2.5 text-[15px] text-white"
                          : "self-start max-w-[92%] rounded-[18px] rounded-bl-[6px] bg-[var(--color-bg-surface)] px-4 py-2.5 text-[15px] text-[var(--color-text-primary)] whitespace-pre-wrap"
                      }
                    >
                      {message.content}
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.cards
                    ? message.cards.map((card, cardIndex) => {
                        const key = `${message.id}:${cardIndex}`;
                        if (card.kind === "transaction_draft") {
                          return (
                            <TransactionDraftCard
                              card={card}
                              confirming={confirmingKey === key && confirmDraft.isPending}
                              key={key}
                              onConfirm={() => {
                                setConfirmingKey(key);
                                confirmDraft.mutate({ message, cardIndex });
                              }}
                              onEdit={() => handleEdit(card.draft)}
                            />
                          );
                        }
                        if (card.kind === "transactions") {
                          return <TransactionsCard card={card} key={key} />;
                        }
                        return <StatsMonthCard card={card} key={key} />;
                      })
                    : null}
                </div>
              ))}
              {streaming ? (
                <div className="flex flex-col gap-2">
                  {/* 与持久化消息一致：出现卡片后不再展示正文增量。 */}
                  {streaming.content && streaming.cards.length === 0 ? (
                    <div className="self-start max-w-[92%] whitespace-pre-wrap rounded-[18px] rounded-bl-[6px] bg-[var(--color-bg-surface)] px-4 py-2.5 text-[15px] text-[var(--color-text-primary)]">
                      {streaming.content}
                    </div>
                  ) : streaming.cards.length === 0 ? (
                    <div className="self-start rounded-[18px] rounded-bl-[6px] bg-[var(--color-bg-surface)] px-4 py-2.5 text-[15px] text-[var(--color-text-muted)]">
                      思考中…
                    </div>
                  ) : null}
                  {streaming.cards.map((card, cardIndex) => {
                    const key = `streaming:${cardIndex}`;
                    if (card.kind === "transaction_draft") {
                      return (
                        <TransactionDraftCard
                          card={card}
                          confirming={false}
                          disabled
                          key={key}
                          onConfirm={() => {}}
                        />
                      );
                    }
                    if (card.kind === "transactions") {
                      return <TransactionsCard card={card} key={key} />;
                    }
                    return <StatsMonthCard card={card} key={key} />;
                  })}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {aiEnabled ? (
          <div className="sticky bottom-0 flex items-end gap-2 border-t border-black/[0.05] bg-[var(--color-bg-app)] pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5">
            <textarea
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-[15px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="例如：昨天打车 32 块"
              rows={1}
              value={input}
            />
            {sending ? (
              <IconButton
                icon={<Square fill="currentColor" size={16} />}
                label="停止生成"
                onClick={handleStop}
                variant="primary"
              />
            ) : (
              <IconButton
                disabled={!input.trim()}
                icon={<Send size={20} />}
                label="发送"
                onClick={() => handleSend()}
                variant="primary"
              />
            )}
          </div>
        ) : null}
      </main>

      <BottomSheet onClose={() => setHistoryOpen(false)} open={historyOpen} title="历史会话">
        <div className="flex flex-col gap-1 pb-4">
          {conversationsQuery.isPending ? (
            <LoadingState rows={3} title="加载会话" />
          ) : (conversationsQuery.data?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">还没有历史会话</p>
          ) : (
            conversationsQuery.data!.map((conversation) => (
              <div className="flex items-center gap-1" key={conversation.id}>
                <button
                  className={`min-w-0 flex-1 rounded-[14px] px-3 py-3 text-left ${
                    conversation.id === conversationId
                      ? "bg-[var(--color-control-fill-muted,rgba(0,0,0,0.05))]"
                      : ""
                  }`}
                  onClick={() => {
                    setConversationId(conversation.id);
                    setHistoryOpen(false);
                  }}
                  type="button"
                >
                  <p className="truncate text-[15px] text-[var(--color-text-primary)]">
                    {conversation.title ?? "未命名会话"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {new Date(conversation.updatedAt).toLocaleString("zh-CN")}
                  </p>
                </button>
                <IconButton
                  icon={<Trash2 size={18} />}
                  label="删除会话"
                  onClick={() => {
                    deleteConversation.mutate(conversation.id, {
                      onSuccess: () => {
                        if (conversation.id === conversationId) startNewConversation();
                      },
                      onError: (error) => {
                        showToast({
                          tone: "error",
                          message: getApiErrorMessage(error, "删除失败"),
                        });
                      },
                    });
                  }}
                />
              </div>
            ))
          )}
        </div>
      </BottomSheet>
    </MobileAppShell>
  );
}
