"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronLeft,
  History,
  ImagePlus,
  Mic,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { AttachmentPreview, LoadingState, type AttachmentItem } from "@/components/business";
import {
  BottomSheet,
  IconButton,
  MobileAppShell,
  NavigationBar,
  PopoverMenu,
} from "@/components/ui";
import {
  aiConversationsPath,
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type AiCard,
  type AiConversationSummary,
  type AiMessage,
  type TransactionDetail,
  type TransactionInput,
} from "@/lib/api";
import {
  streamAiChat,
  useAiConversation,
  useAiStatus,
  useInfiniteAiConversations,
  useDeleteAiConversation,
  useUpdateAiCardState,
  useUpdateAiDrafts,
  useVoidAiCard,
  patchAiConversationMessage,
} from "@/lib/data/ai";
import { AI_ACTIVE_CONVERSATION_KEY, aiCardIdempotencyKey } from "@/lib/data/ai-draft-handoff";
import { useAccounts, useCategories, usePeople } from "@/lib/data/records";
import { compressImageForUpload } from "@/lib/image/compress-image";
import { useSpeechInput } from "@/lib/hooks/useSpeechInput";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useToast } from "@/providers";
import {
  AccountBalancesCard,
  BudgetProgressCard,
  StatsMonthCard,
  StatsPeriodCard,
  TransactionDraftCard,
  TransactionsCard,
} from "./_components/AiCards";
import {
  AiDraftBatchPanel,
  type DraftEntry,
  type DraftPatch,
} from "./_components/AiDraftBatchPanel";
import { AiDraftEditDrawer } from "./_components/AiDraftEditDrawer";

// react-markdown + remark-gfm 体积较大（压缩前约 170K），动态拆出：AI 页外壳先渲染，
// 消息区渲染时才加载；空闲预取 /ai 路由时也不必连带下载它。
const AiMarkdown = dynamic(
  () => import("./_components/AiMarkdown").then((mod) => ({ default: mod.AiMarkdown })),
  { loading: () => null },
);

const SUGGESTIONS = ["昨天午饭花了 45", "这个月吃饭花了多少钱？", "看看上个月的收支统计"];
// 与服务端 MAX_CHAT_IMAGES 一致。
const MAX_IMAGES = 4;
/** 交易已入账、卡片回写失败时的提示（本地已锁卡，服务端加载会话时补回写）。 */
const CARD_SYNC_FAILED = "卡片状态同步失败，重新进入会话后会自动补上";
/** 模型只出卡片、没出文字时服务端落的占位正文（同 apps/api 的 AI_CARDS_ONLY_PLACEHOLDER）。 */
const AI_CARDS_ONLY_PLACEHOLDER = "已生成上面的卡片，请查看。";

/** 用户消息是否附图（本地刚发出的看预览，持久化的看附件）。 */
function hasImages(message: AiMessage | undefined) {
  return (
    message?.role === "user" && Boolean(message.localImageUrls?.length || message.images?.length)
  );
}

type PendingImage = { id: string; blob: Blob; url: string };

/**
 * 用户消息附图：本地刚发出的用 object URL，历史消息按附件 id 鉴权取图。
 * items/onOpen 必须稳定：AttachmentPreview 以它们为依赖异步拉缩略图，聊天页频繁重渲染
 * （流式增量）若每次都给新引用，进行中的拉取会被判为过期丢弃，缩略图就一直出不来。
 */
function MessageImages({ ledgerId, message }: { ledgerId: string; message: AiMessage }) {
  const { localImageUrls, images } = message;
  const items = useMemo<AttachmentItem[]>(
    () =>
      localImageUrls?.length
        ? localImageUrls.map((url, index) => ({
            id: `${message.id}-local-${index}`,
            name: `图片 ${index + 1}`,
            contentType: "image/jpeg",
            url,
          }))
        : (images ?? []).map((image, index) => ({
            id: image.attachmentId,
            name: `图片 ${index + 1}`,
            contentType: "image/jpeg",
          })),
    [message.id, localImageUrls, images],
  );
  const openImage = useCallback(
    (item: AttachmentItem) =>
      item.url ??
      createAuthorizedObjectUrl(ledgerApiPath(ledgerId, `/attachments/${item.id}/content`)),
    [ledgerId],
  );
  if (items.length === 0) return null;
  return (
    <div className="ai-msg-images">
      <AttachmentPreview items={items} onOpen={openImage} variant="grid" />
    </div>
  );
}

function draftToTransactionInput(
  draft: Extract<AiCard, { kind: "transaction_draft" }>["draft"],
): TransactionInput {
  return {
    type: draft.type,
    grossAmountMicros: draft.grossAmountMicros,
    occurredOn: draft.occurredOn,
    ...(draft.currency ? { currency: draft.currency } : {}),
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
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { currentLedger } = useLedger();
  const ledgerId = currentLedger?.id ?? null;

  const aiStatusQuery = useAiStatus(ledgerId);
  const visionEnabled = aiStatusQuery.data?.vision === true;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  // 批量确认/作废是逐笔串行的异步流程，循环里要读到最新消息（卡片状态随每笔回写而变）。
  const messagesRef = useRef<AiMessage[]>([]);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef(pendingImages);
  pendingImagesRef.current = pendingImages;
  // 已发出图片的预览 URL：本地消息还在用，等它们被服务端消息替换（切换/新建会话）或离开页面时回收。
  const sentImageUrlsRef = useRef<string[]>([]);
  const releaseSentImages = useCallback(() => {
    for (const url of sentImageUrlsRef.current) URL.revokeObjectURL(url);
    sentImageUrlsRef.current = [];
  }, []);
  useEffect(
    () => () => {
      releaseSentImages();
      for (const image of pendingImagesRef.current) URL.revokeObjectURL(image.url);
    },
    [releaseSentImages],
  );
  const [compressing, setCompressing] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 正在批量确认/作废的消息 id。
  const [batchBusyId, setBatchBusyId] = useState<string | null>(null);
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  // 输入框随内容自动增高：先归零测量 scrollHeight，再钳到 CSS max-height。
  // 未超上限时隐藏滚动条（否则空行/单行会因亚像素取整误显），超出后才允许内部滚动。
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // 正在确认的草稿卡（"messageId:cardIndex"），用于按钮 loading 态与防连点。
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  // 正在作废的草稿卡（"messageId:cardIndex"），同上。
  const [voidingKey, setVoidingKey] = useState<string | null>(null);

  const conversationQuery = useAiConversation(ledgerId, conversationId);
  const conversationsQuery = useInfiniteAiConversations(historyOpen ? ledgerId : null);
  const conversations = conversationsQuery.data?.pages.flat() ?? [];
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = conversationsQuery;
  // 历史会话滚动到底部前自动拉下一页；sentinel 进入视口即触发（sheet-body 内滚动也能感知）。
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !historyOpen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [historyOpen, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const deleteConversation = useDeleteAiConversation(ledgerId);
  const updateCardState = useUpdateAiCardState(ledgerId);
  const voidCard = useVoidAiCard(ledgerId);
  const updateDrafts = useUpdateAiDrafts(ledgerId);
  // 流式进行中的助手消息（未持久化）：delta 增量拼正文、card 事件实时追加；done 后替换为持久化消息。
  // withImages：带图的一轮（识别账单）草稿先不上屏，见下方流式渲染。
  const [streaming, setStreaming] = useState<{
    content: string;
    cards: AiCard[];
    withImages: boolean;
  } | null>(null);
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
    // 服务端消息里的附图走附件接口，本地预览不再被引用。
    releaseSentImages();
  }, [conversationData, releaseSentImages]);

  // 去记一笔会离开本页（router.push），返回时组件重挂载。恢复上次活跃会话 id，
  // 让用户回到原对话（消息从服务端重新加载），而不是空白的新对话。
  const activeRestoredRef = useRef(false);
  useEffect(() => {
    if (activeRestoredRef.current) return;
    activeRestoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
      if (saved) setConversationId(saved);
    } catch {
      // 读取失败按新对话处理
    }
  }, []);
  // 恢复完成后再持久化，避免首帧的 null 覆盖掉已存会话 id。
  useEffect(() => {
    if (!activeRestoredRef.current) return;
    try {
      if (conversationId) sessionStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, conversationId);
      else sessionStorage.removeItem(AI_ACTIVE_CONVERSATION_KEY);
    } catch {
      // 持久化失败不影响使用
    }
  }, [conversationId]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  /** 一条消息被更新（卡片确认/作废/改草稿）后同步本地列表与会话详情缓存。 */
  const applyUpdatedMessage = (updatedMessage: AiMessage) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
    );
    // 同步会话详情缓存，离开再返回时恢复的卡片仍是最新状态。
    if (conversationId) {
      patchAiConversationMessage(queryClient, ledgerId!, conversationId, updatedMessage);
    }
  };

  const invalidateLedgerData = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "stats"] }),
    ]);

  /**
   * 交易已按卡片幂等键创建后回写卡片（失败重试一次）。仍失败时也必须在本地把卡片锁成已入账：
   * 留着待确认的话，再编辑提交只会重放第一笔交易（改动不生效、附件/关联挂到旧交易上），
   * 作废则留下「卡片已作废、交易实际存在」。服务端加载会话时按幂等记录补回写
   * （AiService.reconcileDraftCards），作废接口也会拒绝已有交易的卡片。
   */
  const settleCard = async (
    message: AiMessage,
    cardIndex: number,
    transactionId: string,
  ): Promise<{ message: AiMessage; synced: boolean }> => {
    const writeBack = () =>
      updateCardState.mutateAsync({ messageId: message.id, cardIndex, transactionId });
    try {
      const updated = await writeBack().catch(writeBack);
      applyUpdatedMessage(updated);
      return { message: updated, synced: true };
    } catch {
      const card = message.cards?.[cardIndex];
      if (!message.cards || card?.kind !== "transaction_draft") return { message, synced: false };
      const cards = [...message.cards];
      cards[cardIndex] = { ...card, status: "confirmed", transactionId };
      const locked = { ...message, cards };
      applyUpdatedMessage(locked);
      return { message: locked, synced: false };
    }
  };

  const createTransactionForCard = async (message: AiMessage, cardIndex: number) => {
    const card = message.cards?.[cardIndex];
    if (!card || card.kind !== "transaction_draft") throw new Error("卡片不存在");
    const transaction = await apiRequest<TransactionDetail>(
      ledgerApiPath(ledgerId!, "/transactions"),
      {
        method: "POST",
        body: draftToTransactionInput(card.draft),
        // 幂等键与卡片一一对应：重复点击/失败重试不会重复入账。
        headers: { "idempotency-key": aiCardIdempotencyKey(message.id, cardIndex) },
      },
    );
    return settleCard(message, cardIndex, transaction.id);
  };

  /**
   * 批量确认：逐笔按各自幂等键入账并回写卡片，一笔失败不影响其它笔；失败的保持待确认，
   * 用户可改完再点一次，已成功的不会重复入账。
   */
  const confirmDraftsBatch = async (messageId: string, cardIndexes: number[]) => {
    let current = messagesRef.current.find((message) => message.id === messageId);
    if (!current || batchBusyId) return;
    setBatchBusyId(messageId);
    let succeeded = 0;
    let unsynced = 0;
    let firstError: string | null = null;
    let failed = 0;
    try {
      for (const cardIndex of cardIndexes) {
        const card = current.cards?.[cardIndex];
        if (!card || card.kind !== "transaction_draft" || card.status !== "proposed") continue;
        try {
          const settled = await createTransactionForCard(current, cardIndex);
          current = settled.message;
          succeeded++;
          if (!settled.synced) unsynced++;
        } catch (error) {
          failed++;
          firstError ??= getApiErrorMessage(error, "入账失败");
        }
      }
    } finally {
      setBatchBusyId(null);
    }
    if (failed === 0 && unsynced === 0) {
      showToast({ tone: "success", message: `已入账 ${succeeded} 笔` });
    } else {
      const parts = [`已入账 ${succeeded} 笔`];
      if (failed > 0) parts.push(`${failed} 笔失败：${firstError}`);
      if (unsynced > 0) parts.push(`其中 ${unsynced} 笔${CARD_SYNC_FAILED}`);
      showToast({ tone: "error", message: parts.join("，") });
    }
    if (succeeded > 0) await invalidateLedgerData();
  };

  const voidDraftsBatch = async (messageId: string, cardIndexes: number[]) => {
    if (batchBusyId) return;
    setBatchBusyId(messageId);
    let voided = 0;
    let firstError: string | null = null;
    try {
      for (const cardIndex of cardIndexes) {
        try {
          applyUpdatedMessage(await voidCard.mutateAsync({ messageId, cardIndex }));
          voided++;
        } catch (error) {
          firstError ??= getApiErrorMessage(error, "作废失败");
        }
      }
    } finally {
      setBatchBusyId(null);
    }
    showToast(
      firstError
        ? { tone: "error", message: `已作废 ${voided} 笔，其余失败：${firstError}` }
        : { tone: "success", message: `已作废 ${voided} 笔` },
    );
  };

  const saveDrafts = async (messageId: string, drafts: DraftPatch[]) => {
    if (drafts.length === 0) return;
    applyUpdatedMessage(await updateDrafts.mutateAsync({ messageId, drafts }));
  };

  const confirmDraft = useMutation({
    mutationFn: ({ message, cardIndex }: { message: AiMessage; cardIndex: number }) =>
      createTransactionForCard(message, cardIndex),
    onSuccess: async ({ synced }) => {
      showToast(
        synced
          ? { tone: "success", message: "已入账" }
          : { tone: "error", message: `已入账，但${CARD_SYNC_FAILED}` },
      );
      await invalidateLedgerData();
    },
    onSettled: () => setConfirmingKey(null),
  });

  const voidDraft = useMutation({
    mutationFn: ({ message, cardIndex }: { message: AiMessage; cardIndex: number }) =>
      voidCard.mutateAsync({ messageId: message.id, cardIndex }),
    onSuccess: (updatedMessage) => {
      applyUpdatedMessage(updatedMessage);
      showToast({ tone: "success", message: "已作废" });
    },
    // 错误提示交给全局 onError 统一处理（内层 voidCard 已 suppress），避免重复。
    onSettled: () => setVoidingKey(null),
  });

  const abortRef = useRef<AbortController | null>(null);
  const handleStop = () => abortRef.current?.abort();

  // 语音输入：录音开始时记住已有文本，转写结果实时拼在其后（中文无需分隔符）。
  const speechBaseRef = useRef("");
  const peopleQuery = usePeople(ledgerId);
  // 人员名是通用识别模型最弱的短专有名词，作为热词传给识别引擎
  //（仅支持 contextual biasing 的浏览器生效，其余静默忽略）。
  const speechPhrases = useMemo(
    () => (peopleQuery.data ?? []).map((person) => person.name),
    [peopleQuery.data],
  );
  const speech = useSpeechInput({
    phrases: speechPhrases,
    onTranscript: (transcript) => setInput(speechBaseRef.current + transcript),
    onError: (message) => showToast({ tone: "error", message }),
  });
  const handleVoiceToggle = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speechBaseRef.current = input;
    speech.start();
  };

  // 正在压缩、还没进列表的图片占用的名额：压缩期间仍可继续选图/粘贴，不预留会突破上限。
  const reservedImagesRef = useRef(0);
  const addImages = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/") || !file.type);
    if (images.length === 0) return;
    const room = MAX_IMAGES - pendingImages.length - reservedImagesRef.current;
    if (room <= 0) {
      showToast({ tone: "error", message: `一次最多上传 ${MAX_IMAGES} 张图片` });
      return;
    }
    if (images.length > room) {
      showToast({ tone: "error", message: `一次最多上传 ${MAX_IMAGES} 张，已取前 ${room} 张` });
    }
    const accepted = images.slice(0, room);
    reservedImagesRef.current += accepted.length;
    setCompressing((count) => count + 1);
    try {
      for (const file of accepted) {
        try {
          const blob = await compressImageForUpload(file);
          setPendingImages((prev) => {
            // 兜底：预留之外的并发路径也不能让列表超过上限。
            if (prev.length >= MAX_IMAGES) return prev;
            return [
              ...prev,
              { id: `${Date.now()}-${Math.random()}`, blob, url: URL.createObjectURL(blob) },
            ];
          });
        } catch (error) {
          showToast({
            tone: "error",
            message: error instanceof Error ? error.message : "图片处理失败",
          });
        }
      }
    } finally {
      reservedImagesRef.current -= accepted.length;
      setCompressing((count) => count - 1);
    }
  };

  const pendingImageItems = useMemo<AttachmentItem[]>(
    () =>
      pendingImages.map((image, index) => ({
        id: image.id,
        name: `图片 ${index + 1}`,
        contentType: "image/jpeg",
        url: image.url,
      })),
    [pendingImages],
  );

  const removePendingImage = (id: string) =>
    setPendingImages((prev) => {
      const target = prev.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((image) => image.id !== id);
    });

  const handleSend = (raw?: string) => {
    const content = (raw ?? input).trim();
    const images = raw === undefined ? pendingImages : [];
    if ((!content && images.length === 0) || sending || compressing > 0 || !ledgerId) return;
    if (speech.listening) speech.cancel();
    setInput("");
    // 预览 URL 交给本地消息继续展示，登记后由 releaseSentImages 统一回收。
    sentImageUrlsRef.current.push(...images.map((image) => image.url));
    setPendingImages([]);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        cards: null,
        ...(images.length > 0 ? { localImageUrls: images.map((image) => image.url) } : {}),
        createdAt: new Date().toISOString(),
      },
    ]);
    setStreaming({ content: "", cards: [], withImages: images.length > 0 });
    const abort = new AbortController();
    abortRef.current = abort;
    void (async () => {
      try {
        const result = await streamAiChat(
          ledgerId,
          {
            ...(conversationId ? { conversationId } : {}),
            content,
            images: images.map((image) => image.blob),
          },
          {
            onDelta: (text) =>
              setStreaming((prev) => ({
                content: (prev?.content ?? "") + text,
                cards: prev?.cards ?? [],
                withImages: prev?.withImages ?? false,
              })),
            onCard: (card) =>
              setStreaming((prev) => ({
                content: prev?.content ?? "",
                cards: [...(prev?.cards ?? []), card],
                withImages: prev?.withImages ?? false,
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

  // 正在编辑的草稿：单卡「编辑」与批量面板点行共用同一个全屏抽屉，不切路由。
  const [editingDraft, setEditingDraft] = useState<{ messageId: string; cardIndex: number } | null>(
    null,
  );
  const handleEdit = (messageId: string, cardIndex: number) =>
    setEditingDraft({ messageId, cardIndex });
  const editingCard = (() => {
    if (!editingDraft) return null;
    const card = messages.find((message) => message.id === editingDraft.messageId)?.cards?.[
      editingDraft.cardIndex
    ];
    return card?.kind === "transaction_draft" && card.status === "proposed" ? card : null;
  })();

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    releaseSentImages();
    setHistoryOpen(false);
  };

  const aiEnabled = aiStatusQuery.data?.enabled === true;
  // 仅当目标会话尚未在本地就绪时才显示骨架：新对话结束后已把 loadedConversationRef 指向新
  // 会话（消息就在屏上），此时后台详情请求 pending 不应再盖骨架；从历史切到未加载的会话才显示。
  const loadingConversation =
    Boolean(conversationId) &&
    conversationQuery.isPending &&
    loadedConversationRef.current !== conversationId;

  // 输入栏按钮：生成中只显示停止；录音中显示「录音」按钮（点它暂停录音）；有内容则同时显示发送
  // （点发送会先停录音再发）。故录音且有内容时录音与发送并存，用户可二选一。
  const hasInput = input.trim().length > 0 || pendingImages.length > 0;
  const showStop = sending;
  const showMic = !sending && speech.supported && (speech.listening || !hasInput);
  const showSend = !sending && (hasInput || !speech.supported);

  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  /**
   * 渲染一条助手消息的卡片：草稿 ≥2 笔时合并成批量面板（放在第一张草稿的位置），
   * 其余卡片照常逐张渲染。streaming 时消息尚未持久化，草稿只展示不可操作。
   */
  const renderCards = (cards: AiCard[], message: AiMessage | null) => {
    const keyPrefix = message?.id ?? "streaming";
    const drafts: DraftEntry[] = [];
    cards.forEach((card, cardIndex) => {
      if (card.kind === "transaction_draft") drafts.push({ card, cardIndex });
    });
    const useBatch = drafts.length >= 2;
    return cards.map((card, cardIndex) => {
      const key = `${keyPrefix}:${cardIndex}`;
      if (card.kind === "transaction_draft") {
        if (useBatch) {
          if (cardIndex !== drafts[0]!.cardIndex) return null;
          return (
            <AiDraftBatchPanel
              accounts={accounts}
              people={peopleQuery.data ?? []}
              busy={message !== null && batchBusyId === message.id}
              categories={categories}
              disabled={message === null}
              entries={drafts}
              key={`${keyPrefix}:batch`}
              onConfirm={(indexes) => message && void confirmDraftsBatch(message.id, indexes)}
              onEdit={(index) => message && handleEdit(message.id, index)}
              onSave={(patches) => (message ? saveDrafts(message.id, patches) : Promise.resolve())}
              onVoid={(indexes) => message && void voidDraftsBatch(message.id, indexes)}
            />
          );
        }
        if (!message) {
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
        return (
          <TransactionDraftCard
            card={card}
            confirming={confirmingKey === key && confirmDraft.isPending}
            key={key}
            onConfirm={() => {
              setConfirmingKey(key);
              confirmDraft.mutate({ message, cardIndex });
            }}
            onEdit={() => handleEdit(message.id, cardIndex)}
            onVoid={() => {
              setVoidingKey(key);
              voidDraft.mutate({ message, cardIndex });
            }}
            voiding={voidingKey === key && voidDraft.isPending}
          />
        );
      }
      if (card.kind === "transactions") {
        return <TransactionsCard card={card} key={key} />;
      }
      if (card.kind === "stats_period") {
        return <StatsPeriodCard card={card} key={key} />;
      }
      if (card.kind === "account_balances") {
        return <AccountBalancesCard card={card} key={key} />;
      }
      if (card.kind === "budget_progress") {
        return <BudgetProgressCard card={card} key={key} />;
      }
      return <StatsMonthCard card={card} key={key} />;
    });
  };

  return (
    <MobileAppShell>
      <main className="flex h-dvh flex-col px-[var(--space-page-x)]">
        <NavigationBar
          action={
            <div className="relative">
              <IconButton
                icon={<MoreHorizontal size={22} strokeWidth={2.3} />}
                label="更多"
                onClick={() => setMoreMenuOpen((open) => !open)}
              />
              <PopoverMenu
                groups={[
                  [
                    {
                      icon: <Plus size={18} />,
                      label: "新建对话",
                      onSelect: startNewConversation,
                    },
                    {
                      icon: <History size={18} />,
                      label: "历史记录",
                      onSelect: () => setHistoryOpen(true),
                    },
                  ],
                  [
                    {
                      icon: <NotebookPen size={18} />,
                      label: "手动记账",
                      onSelect: () => router.push(routes.billNew),
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          }
          className="mb-0!"
          leading={
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={() => router.back()}
            />
          }
          title=""
          variant="inline"
        />

        <div className="-mr-[var(--space-page-x)] flex-1 overflow-y-auto pb-4 pr-[var(--space-page-x)]">
          {aiStatusQuery.isPending ? (
            <LoadingState rows={2} title="加载中" />
          ) : !aiEnabled ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Sparkles className="text-[var(--color-text-muted)]" size={28} />
              <p className="font-semibold text-[var(--color-text-primary)]">AI Agent 未启用</p>
              <p className="max-w-[280px] text-sm text-[var(--color-text-muted)]">
                在服务端配置 AI_BASE_URL / AI_API_KEY / AI_MODEL 后即可使用自然语言记账与查询。
              </p>
            </div>
          ) : loadingConversation ? (
            <LoadingState rows={3} title="加载会话" />
          ) : messages.length === 0 ? (
            <div className="ai-empty">
              <div className="ai-empty__badge">
                <Sparkles size={30} strokeWidth={2.1} />
              </div>
              <div>
                <p className="ai-empty__title">我们先从哪里开始呢？</p>
                <p className="ai-empty__hint">
                  {visionEnabled
                    ? "可以直接上传账单截图批量记账，草稿需要你确认后才会入账"
                    : "记账草稿需要你确认后才会入账"}
                </p>
              </div>
              {/* <div className="flex flex-col gap-2">
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
              </div> */}
            </div>
          ) : (
            <div className="ai-thread">
              {messages.map((message, messageIndex) => (
                <div className="ai-turn" key={message.id}>
                  {message.role === "user" && ledgerId ? (
                    <MessageImages ledgerId={ledgerId} message={message} />
                  ) : null}
                  {/* 有卡片时正文不展示（模型正文只是卡片的复述），避免信息重复。
                      例外：识别账单（上一条用户消息带图）或多笔草稿的收尾总结会说明跳过了哪几笔，
                      要保留、放在卡片上方；但「只有卡片」的占位文案没有信息量，照样不展示。 */}
                  {message.content &&
                  !(
                    message.role === "assistant" &&
                    (message.cards?.length ?? 0) > 0 &&
                    (message.content === AI_CARDS_ONLY_PLACEHOLDER ||
                      ((message.cards?.filter((card) => card.kind === "transaction_draft").length ??
                        0) < 2 &&
                        !hasImages(messages[messageIndex - 1])))
                  ) ? (
                    <div
                      className={
                        message.role === "user" ? "ai-msg ai-msg--user" : "ai-msg ai-msg--ai"
                      }
                    >
                      {message.role === "assistant" ? (
                        <AiMarkdown content={message.content} />
                      ) : (
                        message.content
                      )}
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.cards
                    ? renderCards(message.cards, message)
                    : null}
                </div>
              ))}
              {streaming
                ? (() => {
                    // 识别账单：草稿一笔笔到达，若边到边渲染会先冒出单卡、再变批量面板、最后才
                    // 出总结文字。所以带图的一轮草稿先不上屏，只显示进度；结束后按「文字 → 待确认
                    // 列表」一次性呈现（与持久化消息同一布局）。
                    const draftCount = streaming.cards.filter(
                      (card) => card.kind === "transaction_draft",
                    ).length;
                    const holdDrafts = streaming.withImages && draftCount > 0;
                    const visibleCards = holdDrafts
                      ? streaming.cards.filter((card) => card.kind !== "transaction_draft")
                      : streaming.cards;
                    // 与持久化消息一致：出现卡片后不再展示正文增量；识别账单的总结例外。
                    const showContent =
                      Boolean(streaming.content) && (holdDrafts || streaming.cards.length === 0);
                    const typing = (label?: string) => (
                      <div
                        aria-label={label ?? "思考中"}
                        className="ai-msg ai-msg--ai flex items-center gap-2"
                      >
                        <span className="ai-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                        {label ? (
                          <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
                        ) : null}
                      </div>
                    );
                    return (
                      <div className="ai-turn">
                        {showContent ? (
                          <div className="ai-msg ai-msg--ai">
                            <AiMarkdown content={streaming.content} />
                          </div>
                        ) : null}
                        {holdDrafts
                          ? typing(`已识别 ${draftCount} 笔，正在整理`)
                          : !showContent && streaming.cards.length === 0
                            ? typing()
                            : null}
                        {renderCards(visibleCards, null)}
                      </div>
                    );
                  })()
                : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {aiEnabled ? (
          <div className="ai-composer">
            {pendingImages.length > 0 || compressing > 0 ? (
              <div className="ai-composer__images">
                <AttachmentPreview
                  items={pendingImageItems}
                  onRemove={removePendingImage}
                  variant="grid"
                />
                {compressing > 0 ? (
                  <span className="ai-composer__compressing">处理图片中…</span>
                ) : null}
              </div>
            ) : null}
            {visionEnabled ? (
              <input
                accept="image/*"
                className="hidden"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  // 清空以便再次选择同一张图也能触发 change。
                  event.target.value = "";
                  void addImages(files);
                }}
                ref={fileInputRef}
                type="file"
              />
            ) : null}
            {/* 录音/发送/停止钮视觉上落在输入框内：外层胶囊持材质与边框，textarea 去边框透明、
                按钮靠底对齐（多行时钮固定在底部，apple-design §16 简洁 + §12 材质）。 */}
            <div className="ai-composer__field">
              {visionEnabled ? (
                <button
                  aria-label="上传账单图片"
                  className="ai-composer__btn ai-composer__btn--mic ai-composer__btn--attach"
                  disabled={sending || pendingImages.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  title="上传账单图片"
                  type="button"
                >
                  <ImagePlus size={20} />
                </button>
              ) : null}
              <textarea
                ref={inputRef}
                className="ai-composer__input"
                onChange={(event) => {
                  // 录音中手动改字则停止识别，避免后续转写覆盖手动编辑。
                  if (speech.listening) speech.stop();
                  setInput(event.target.value);
                }}
                onPaste={(event) => {
                  if (!visionEnabled) return;
                  const files = Array.from(event.clipboardData.files).filter((file) =>
                    file.type.startsWith("image/"),
                  );
                  if (files.length === 0) return;
                  event.preventDefault();
                  void addImages(files);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  speech.listening
                    ? "正在聆听…"
                    : pendingImages.length > 0
                      ? "补充说明（可选）"
                      : "请输入"
                }
                rows={1}
                value={input}
              />
              {showMic ? (
                <button
                  aria-label={speech.listening ? "停止语音输入" : "语音输入"}
                  className={`ai-composer__btn ai-composer__btn--mic${speech.listening ? " is-listening" : ""}`}
                  onClick={handleVoiceToggle}
                  title={speech.listening ? "停止语音输入" : "语音输入"}
                  type="button"
                >
                  <Mic className={speech.listening ? "animate-pulse" : ""} size={20} />
                </button>
              ) : null}
              {showStop ? (
                <button
                  aria-label="停止生成"
                  className="ai-composer__btn ai-composer__btn--send ai-composer__btn--enter"
                  onClick={handleStop}
                  title="停止生成"
                  type="button"
                >
                  <Square fill="currentColor" size={15} />
                </button>
              ) : showSend ? (
                <button
                  aria-label="发送"
                  className="ai-composer__btn ai-composer__btn--send ai-composer__btn--enter"
                  disabled={!hasInput || compressing > 0}
                  onClick={() => handleSend()}
                  title="发送"
                  type="button"
                >
                  <ArrowUp size={20} strokeWidth={2.6} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>

      <AiDraftEditDrawer
        card={editingCard}
        editKey={editingDraft ? `${editingDraft.messageId}:${editingDraft.cardIndex}` : "none"}
        idempotencyKey={
          editingDraft ? aiCardIdempotencyKey(editingDraft.messageId, editingDraft.cardIndex) : ""
        }
        onClose={() => setEditingDraft(null)}
        onSaved={async (transaction) => {
          if (!editingDraft) return;
          const message = messagesRef.current.find((item) => item.id === editingDraft.messageId);
          setEditingDraft(null);
          if (!message) return;
          // 「已记一笔」与缓存刷新由表单负责，这里只回写卡片。
          const { synced } = await settleCard(message, editingDraft.cardIndex, transaction.id);
          if (!synced) showToast({ tone: "error", message: CARD_SYNC_FAILED });
        }}
        open={editingDraft !== null}
      />

      <BottomSheet
        className="ui-bottom-sheet--edge-scroll"
        onClose={() => setHistoryOpen(false)}
        open={historyOpen}
        title="历史会话"
      >
        <div className="flex flex-col gap-1 pb-4">
          {conversationsQuery.isPending ? (
            <LoadingState rows={3} title="加载会话" />
          ) : conversations.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              还没有历史会话
            </p>
          ) : (
            <>
              {conversations.map((conversation) => (
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
                      });
                    }}
                  />
                </div>
              ))}
              {hasNextPage ? (
                <div
                  className="py-3 text-center text-xs text-[var(--color-text-muted)]"
                  ref={loadMoreRef}
                >
                  加载中…
                </div>
              ) : null}
            </>
          )}
        </div>
      </BottomSheet>
    </MobileAppShell>
  );
}
