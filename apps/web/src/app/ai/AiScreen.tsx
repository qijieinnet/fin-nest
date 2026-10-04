"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  History,
  ImagePlus,
  Mic,
  MoreHorizontal,
  NotebookPen,
  PenLine,
  PieChart,
  Plus,
  Sparkles,
  Square,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  AttachmentPreview,
  EmptyState,
  LoadingState,
  type AttachmentItem,
} from "@/components/business";
import {
  BottomSheet,
  Button,
  IconButton,
  MobileAppShell,
  NavigationBar,
  PopoverMenu,
} from "@/components/ui";
import {
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type AiCard,
  type AiConversationDetail,
  type AiConversationSummary,
  type AiMessage,
  type TransactionDetail,
  type TransactionInput,
} from "@/lib/api";
import {
  useAiStatus,
  useInfiniteAiConversations,
  useDeleteAiConversation,
  useUpdateAiCardState,
  useUpdateAiDrafts,
  useVoidAiCard,
  patchAiConversationMessage,
} from "@/lib/data/ai";
import { fetchConsistentConversationDetail } from "@/lib/data/ai-chat-run";
import { AI_ACTIVE_CONVERSATION_KEY, aiCardIdempotencyKey } from "@/lib/data/ai-draft-handoff";
import { useAccounts, useCategories, usePeople } from "@/lib/data/records";
import { compressImageForUpload } from "@/lib/image/compress-image";
import { useSpeechInput } from "@/lib/hooks/useSpeechInput";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useToast } from "@/providers";
import { useAiChatRounds } from "./useAiChatRounds";
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

/** 空态能力入口：点一下把示例填进输入框（不直接发送），用户改完再发。 */
const STARTERS = [
  {
    icon: PenLine,
    color: "var(--color-tint)",
    title: "说一句就记账",
    example: "昨天午饭 32，微信付的",
  },
  { icon: PieChart, color: "oklch(0.7 0.16 25)", title: "查花销", example: "这个月吃饭花了多少？" },
  {
    icon: Wallet,
    color: "oklch(0.68 0.14 160)",
    title: "看资产",
    example: "我现在总资产还有多少？",
  },
  { icon: Target, color: "oklch(0.7 0.15 60)", title: "看预算", example: "这个月预算还剩多少？" },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** 历史会话按更新时间分组：今天 / 昨天 / 近 7 天 / 更早。 */
function groupConversations(conversations: AiConversationSummary[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groups: { label: string; items: AiConversationSummary[] }[] = [];
  for (const conversation of conversations) {
    const updated = new Date(conversation.updatedAt).getTime();
    const label =
      updated >= startOfToday.getTime()
        ? "今天"
        : updated >= startOfToday.getTime() - day
          ? "昨天"
          : updated >= startOfToday.getTime() - 6 * day
            ? "近 7 天"
            : "更早";
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(conversation);
    else groups.push({ label, items: [conversation] });
  }
  return groups;
}

function conversationTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const hm = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // 今天/昨天两组的组标题已给出日期，行内只需时刻。
  if (date.getTime() >= startOfToday.getTime() - 86_400_000) return hm;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === startOfToday.getFullYear() ? md : `${date.getFullYear()}/${md}`;
}
// 与服务端 MAX_CHAT_IMAGES 一致。
const MAX_IMAGES = 4;
/** 打开会话时首次加载的放弃时限（见 fetchConsistentConversationDetail 的 giveUpAfterMs）。 */
const FIRST_LOAD_GIVE_UP_MS = 20_000;

/** 卡片所属会话（账本 + 会话 id）。 */
type ConversationTarget = { ledgerId: string; conversationId: string };

let viewTokenSeq = 0;
/** 新对话视图的临时 key（不与会话 id 冲突）。 */
function newViewToken(): string {
  viewTokenSeq += 1;
  return `new:${viewTokenSeq}`;
}

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
  // 当前视图：已有会话时是会话 id；新对话视图用一个临时 key，每次「新建对话」都换一个，
  // 这样旧的新对话轮次（还没拿到会话 id）不会串到用户刚新建的空白页上。
  const [newViewKey, setNewViewKey] = useState(newViewToken);
  const viewKey = conversationId ?? newViewKey;
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  // 轮次回调都要核对账本：切换账本后，旧账本迟到的结果不能改动当前页面。
  const ledgerIdRef = useRef(ledgerId);
  ledgerIdRef.current = ledgerId;
  const isCurrentView = (round: { ledgerId: string }, key: string) =>
    round.ledgerId === ledgerIdRef.current && key === viewKeyRef.current;

  // 当前视图的消息已从哪个会话整体加载过：只在打开「另一个」会话时才整体加载一次，
  // 之后由轮次收尾（settle）与卡片回写更新，避免本地临时内容被整屏替换（视觉上像刷新）。
  const loadedConversationRef = useRef<string | null>(null);
  // 会话首次加载状态（加载中/失败/重试）与标题。
  const [conversationLoad, setConversationLoad] = useState<{
    id: string;
    status: "loading" | "error";
  } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [conversationTitles, setConversationTitles] = useState<Record<string, string | null>>({});
  const rememberTitle = (detail: AiConversationDetail) =>
    setConversationTitles((prev) => ({
      ...prev,
      [detail.conversation.id]: detail.conversation.title,
    }));

  // 会话的本地更新版本（见 useAiChatRounds 的 conversationVersion）：防恢复拉到的旧详情覆盖新状态。
  const conversationVersionsRef = useRef(new Map<string, number>());
  const bumpConversation = (id: string) =>
    conversationVersionsRef.current.set(id, (conversationVersionsRef.current.get(id) ?? 0) + 1);

  /**
   * 打开会话的首次加载：与轮次收尾共用 fetchConsistentConversationDetail（拉取前后会话本地版本
   * 一致才返回，卡片更新/轮次收尾会递增版本），页面只有这一个详情加载入口，旧快照不会上屏。
   * 加载期间若轮次收尾已整体上屏更新的详情（loadedRef 已指向该会话），这次结果直接丢弃。
   */
  useEffect(() => {
    if (!ledgerId || !conversationId) return;
    if (loadedConversationRef.current === conversationId) return;
    const target = conversationId;
    const controller = new AbortController();
    setConversationLoad({ id: target, status: "loading" });
    fetchConsistentConversationDetail(ledgerId, target, {
      signal: controller.signal,
      version: () => conversationVersionsRef.current.get(target) ?? 0,
      // 打开会话时网络持续不通，20 秒后就给出「重试」，不必等轮次收尾那样的 2 分钟。
      giveUpAfterMs: FIRST_LOAD_GIVE_UP_MS,
    })
      .then((detail) => {
        if (controller.signal.aborted) return;
        if (!detail) {
          setConversationLoad({ id: target, status: "error" });
          return;
        }
        setConversationLoad(null);
        rememberTitle(detail);
        queryClient.setQueryData(queryKeys.aiConversation(ledgerId, target), detail);
        if (loadedConversationRef.current === target) return;
        loadedConversationRef.current = target;
        setMessages(detail.messages);
        // 服务端消息里的附图走附件接口，本地预览不再被引用。
        releaseSentImages();
      })
      .catch(() => {
        if (!controller.signal.aborted) setConversationLoad({ id: target, status: "error" });
      });
    return () => controller.abort();
    // rememberTitle/queryClient 稳定或无需触发重载；loadAttempt 用于「重试」。
  }, [ledgerId, conversationId, loadAttempt, queryClient, releaseSentImages]);

  const rounds = useAiChatRounds(ledgerId, {
    onConversation: (previous, nextConversationId) => {
      // 用户还停在发送时的新对话视图上：跟随切到刚建好的会话。先记 loadedRef 再设 id，
      // 随后的详情请求返回时不整体覆盖本地消息（防「刷新感」）。
      if (isCurrentView(previous, previous.viewKey) && previous.viewKey !== nextConversationId) {
        loadedConversationRef.current = nextConversationId;
        // ref 同步改：start 与 done 可能在同一批数据里到达，done 的回调不能还看到旧视图。
        viewKeyRef.current = nextConversationId;
        setConversationId(nextConversationId);
      }
    },
    onFinished: (round, result) => {
      // 本轮结束：会话详情是唯一来源（hook 保证拉取前后会话没有本地更新、期间不能发新消息），
      // 当前视图直接整体上屏；不在该会话就只更新缓存，下次打开即是最新。
      const target = result.conversationId;
      bumpConversation(target);
      queryClient.setQueryData(queryKeys.aiConversation(round.ledgerId, target), result.detail);
      rememberTitle(result.detail);
      if (isCurrentView(round, target)) {
        // 先记 loadedRef：在途的首次加载（可能是本轮完成前的旧快照）随后返回时不会再覆盖。
        loadedConversationRef.current = target;
        setMessages(result.detail.messages);
        releaseSentImages();
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiConversations(round.ledgerId) });
    },
    onDiscarded: (round) => {
      if (!isCurrentView(round, round.viewKey) || !round.localMessageId) return;
      // 撤回的本地消息若带图，立即回收其预览 URL（不必等切会话/卸载）。
      const discarded = messagesRef.current.find((message) => message.id === round.localMessageId);
      const urls = discarded?.localImageUrls ?? [];
      if (urls.length > 0) {
        for (const url of urls) URL.revokeObjectURL(url);
        sentImageUrlsRef.current = sentImageUrlsRef.current.filter((url) => !urls.includes(url));
      }
      setMessages((prev) => prev.filter((message) => message.id !== round.localMessageId));
      // 文字还给输入框，方便直接重发（图片需重新选择）。
      setInput((current) => current || round.userContent);
    },
    notify: (tone, message) => showToast({ tone, message }),
    conversationVersion: (id) => conversationVersionsRef.current.get(id) ?? 0,
  });
  // 当前视图里进行中的那一轮（未持久化）：delta 增量拼正文、card 实时追加，结束后换成持久化消息。
  // withImages：带图的一轮（识别账单）草稿先不上屏，见下方流式渲染。
  const streaming = rounds.roundForView(viewKey);
  const sending = streaming !== null;

  /**
   * 打开某个会话：先丢掉它的详情缓存再切换。消息只在首次加载时整体上屏（loadedRef），
   * 若先拿到的是过期缓存（例如轮次在后台完成前拉的），随后的新数据会被挡住；
   * 从服务端重新拉一次最稳妥。
   */
  const openConversation = (id: string) => {
    // 按会话 id 匹配（不依赖 ledgerId：重挂载恢复时账本可能还没加载出来）。
    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          key[0] === "ledger" && key[2] === "ai" && key[3] === "conversations" && key[4] === id
        );
      },
    });
    loadedConversationRef.current = null;
    setEditingDraft(null);
    // 清掉上一个视图的本地消息：加载完成前屏上不留旧内容，也不能在旧列表上继续发送（见 conversationReady）。
    setMessages([]);
    releaseSentImages();
    setConversationId(id);
  };

  // 切换账本：当前会话属于旧账本，回到新对话视图（旧账本的轮次在后台照常收尾）。
  const viewLedgerRef = useRef(ledgerId);
  useEffect(() => {
    if (viewLedgerRef.current === ledgerId) return;
    const switched = viewLedgerRef.current !== null;
    viewLedgerRef.current = ledgerId;
    if (!switched) return;
    setNewViewKey(newViewToken());
    setConversationId(null);
    setMessages([]);
    loadedConversationRef.current = null;
    setEditingDraft(null);
    releaseSentImages();
  }, [ledgerId, releaseSentImages]);

  // 去记一笔会离开本页（router.push），返回时组件重挂载。恢复上次活跃会话，
  // 让用户回到原对话（消息从服务端重新加载），而不是空白的新对话。
  // 记录带上所属账本：在别的页面切了账本再回来，不能恢复出旧账本的会话。
  // 等账本确定后再恢复（首帧账本可能还在加载）。
  const activeRestoredRef = useRef(false);
  useEffect(() => {
    if (activeRestoredRef.current || !ledgerId) return;
    activeRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
      const saved = raw
        ? (JSON.parse(raw) as { ledgerId?: string; conversationId?: string })
        : null;
      if (saved?.conversationId && saved.ledgerId === ledgerId) {
        openConversation(saved.conversationId);
      }
    } catch {
      // 读取失败（含旧版只存会话 id 的纯字符串）按新对话处理
    }
    // 只在账本首次确定时恢复一次（activeRestoredRef 把关），openConversation 不必进依赖。
  }, [ledgerId]);
  // 恢复完成后再持久化，避免首帧的 null 覆盖掉已存会话。
  useEffect(() => {
    if (!activeRestoredRef.current || !ledgerId) return;
    try {
      if (conversationId) {
        sessionStorage.setItem(
          AI_ACTIVE_CONVERSATION_KEY,
          JSON.stringify({ ledgerId, conversationId }),
        );
      } else {
        sessionStorage.removeItem(AI_ACTIVE_CONVERSATION_KEY);
      }
    } catch {
      // 持久化失败不影响使用
    }
  }, [conversationId, ledgerId]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  /** 一条消息被更新（卡片确认/作废/改草稿）后同步本地列表与会话详情缓存。 */
  /** 卡片操作发起时所在的会话（操作完成时用户可能已切走，回写必须认这个而不是「当前会话」）。 */
  const currentTarget = (): ConversationTarget | null =>
    ledgerId && conversationId ? { ledgerId, conversationId } : null;

  /**
   * 卡片更新回写：版本号与详情缓存始终记到卡片所属会话（target）——递增版本让该会话进行中的
   * 收尾弃用旧快照（见 useAiChatRounds.conversationVersion）；只有 target 仍是当前视图才改屏上消息。
   */
  const applyUpdatedMessage = (updatedMessage: AiMessage, target: ConversationTarget) => {
    bumpConversation(target.conversationId);
    patchAiConversationMessage(queryClient, target.ledgerId, target.conversationId, updatedMessage);
    if (target.ledgerId !== ledgerIdRef.current || target.conversationId !== viewKeyRef.current) {
      return;
    }
    setMessages((prev) =>
      prev.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
    );
  };

  const invalidateLedgerData = (targetLedgerId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger", targetLedgerId, "transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", targetLedgerId, "accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", targetLedgerId, "budget-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger", targetLedgerId, "stats"] }),
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
    target: ConversationTarget,
  ): Promise<{ message: AiMessage; synced: boolean }> => {
    const writeBack = () =>
      updateCardState.mutateAsync({
        ledgerId: target.ledgerId,
        messageId: message.id,
        cardIndex,
        transactionId,
      });
    try {
      const updated = await writeBack().catch(writeBack);
      applyUpdatedMessage(updated, target);
      return { message: updated, synced: true };
    } catch {
      const card = message.cards?.[cardIndex];
      if (!message.cards || card?.kind !== "transaction_draft") return { message, synced: false };
      const cards = [...message.cards];
      cards[cardIndex] = { ...card, status: "confirmed", transactionId };
      const locked = { ...message, cards };
      applyUpdatedMessage(locked, target);
      return { message: locked, synced: false };
    }
  };

  const createTransactionForCard = async (
    message: AiMessage,
    cardIndex: number,
    target: ConversationTarget,
  ) => {
    const card = message.cards?.[cardIndex];
    if (!card || card.kind !== "transaction_draft") throw new Error("卡片不存在");
    const transaction = await apiRequest<TransactionDetail>(
      ledgerApiPath(target.ledgerId, "/transactions"),
      {
        method: "POST",
        body: draftToTransactionInput(card.draft),
        // 幂等键与卡片一一对应：重复点击/失败重试不会重复入账。
        headers: { "idempotency-key": aiCardIdempotencyKey(message.id, cardIndex) },
      },
    );
    return settleCard(message, cardIndex, transaction.id, target);
  };

  /**
   * 批量确认：逐笔按各自幂等键入账并回写卡片，一笔失败不影响其它笔；失败的保持待确认，
   * 用户可改完再点一次，已成功的不会重复入账。
   */
  const confirmDraftsBatch = async (messageId: string, cardIndexes: number[]) => {
    let current = messagesRef.current.find((message) => message.id === messageId);
    const target = currentTarget();
    if (!current || !target || batchBusyId) return;
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
          const settled = await createTransactionForCard(current, cardIndex, target);
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
    if (succeeded > 0) await invalidateLedgerData(target.ledgerId);
  };

  const voidDraftsBatch = async (messageId: string, cardIndexes: number[]) => {
    const target = currentTarget();
    if (batchBusyId || !target) return;
    setBatchBusyId(messageId);
    let voided = 0;
    let firstError: string | null = null;
    try {
      for (const cardIndex of cardIndexes) {
        try {
          applyUpdatedMessage(
            await voidCard.mutateAsync({ ledgerId: target.ledgerId, messageId, cardIndex }),
            target,
          );
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
    const target = currentTarget();
    if (drafts.length === 0 || !target) return;
    applyUpdatedMessage(
      await updateDrafts.mutateAsync({ ledgerId: target.ledgerId, messageId, drafts }),
      target,
    );
  };

  const confirmDraft = useMutation({
    mutationFn: ({
      message,
      cardIndex,
      target,
    }: {
      message: AiMessage;
      cardIndex: number;
      target: ConversationTarget;
    }) => createTransactionForCard(message, cardIndex, target),
    onSuccess: async ({ synced }, { target }) => {
      showToast(
        synced
          ? { tone: "success", message: "已入账" }
          : { tone: "error", message: `已入账，但${CARD_SYNC_FAILED}` },
      );
      await invalidateLedgerData(target.ledgerId);
    },
    onSettled: () => setConfirmingKey(null),
  });

  const voidDraft = useMutation({
    mutationFn: ({
      message,
      cardIndex,
      target,
    }: {
      message: AiMessage;
      cardIndex: number;
      target: ConversationTarget;
    }) => voidCard.mutateAsync({ ledgerId: target.ledgerId, messageId: message.id, cardIndex }),
    // 用发起时的 target（mutation 变量），而不是完成时闭包里的当前会话。
    onSuccess: (updatedMessage, { target }) => {
      applyUpdatedMessage(updatedMessage, target);
      showToast({ tone: "success", message: "已作废" });
    },
    // 错误提示交给全局 onError 统一处理（内层 voidCard 已 suppress），避免重复。
    onSettled: () => setVoidingKey(null),
  });

  const handleStop = () => {
    if (streaming) void rounds.stop(streaming.requestId);
  };

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
    if (
      (!content && images.length === 0) ||
      sending ||
      !conversationReady ||
      compressing > 0 ||
      !ledgerId
    ) {
      return;
    }
    if (speech.listening) speech.cancel();
    setInput("");
    // 预览 URL 交给本地消息继续展示，登记后由 releaseSentImages 统一回收。
    sentImageUrlsRef.current.push(...images.map((image) => image.url));
    setPendingImages([]);
    const localMessageId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: localMessageId,
        role: "user",
        content,
        cards: null,
        ...(images.length > 0 ? { localImageUrls: images.map((image) => image.url) } : {}),
        createdAt: new Date().toISOString(),
      },
    ]);
    rounds.send({
      viewKey,
      conversationId,
      content,
      images: images.map((image) => image.blob),
      localMessageId,
    });
  };

  // 正在编辑的草稿：单卡「编辑」与批量面板点行共用同一个全屏抽屉，不切路由。
  // target：打开抽屉时所在的会话，保存后回写卡片认它（见 applyUpdatedMessage）。
  // message：打开时的消息快照——保存成功时用户可能已切走，当前列表里找不到原消息也要能回写。
  // token：每次打开递增，保存回调只关闭「自己那次」打开的抽屉（迟到的回调不能关掉后来打开的）。
  const [editingDraft, setEditingDraft] = useState<{
    messageId: string;
    cardIndex: number;
    target: ConversationTarget;
    message: AiMessage;
    token: number;
  } | null>(null);
  const editTokenRef = useRef(0);
  const handleEdit = (messageId: string, cardIndex: number) => {
    const target = currentTarget();
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!target || !message) return;
    editTokenRef.current += 1;
    setEditingDraft({ messageId, cardIndex, target, message, token: editTokenRef.current });
  };
  const editingCard = (() => {
    if (!editingDraft) return null;
    const card = messages.find((message) => message.id === editingDraft.messageId)?.cards?.[
      editingDraft.cardIndex
    ];
    return card?.kind === "transaction_draft" && card.status === "proposed" ? card : null;
  })();

  const startNewConversation = () => {
    setNewViewKey(newViewToken());
    setConversationId(null);
    setMessages([]);
    // 清空后必须重置：否则再从历史打开刚才那个会话时会被当成「已加载」而跳过，显示空白。
    loadedConversationRef.current = null;
    setEditingDraft(null);
    releaseSentImages();
    setHistoryOpen(false);
  };

  const aiEnabled = aiStatusQuery.data?.enabled === true;
  // 仅当目标会话尚未在本地就绪时才显示骨架：新对话结束后已把 loadedConversationRef 指向新
  // 会话（消息就在屏上），此时后台详情请求 pending 不应再盖骨架；从历史切到未加载的会话才显示。
  const loadingConversation =
    Boolean(conversationId) &&
    conversationLoad?.id === conversationId &&
    conversationLoad.status === "loading" &&
    loadedConversationRef.current !== conversationId;
  // 已有会话在首次加载完成前不能发送：首次加载会整体替换消息列表，期间发出的本地消息会被冲掉。
  // 用「已加载」而不是 isPending 判断——加载失败时同样不能发送（可新建对话或重新打开）。
  const conversationReady = !conversationId || loadedConversationRef.current === conversationId;
  // 首次加载失败：给出重试入口（否则只能新建对话或切走再切回）。
  const conversationLoadFailed =
    Boolean(conversationId) &&
    !conversationReady &&
    conversationLoad?.id === conversationId &&
    conversationLoad.status === "error";

  // 输入栏按钮：生成中只显示停止；录音中显示「录音」按钮（点它暂停录音）；有内容则同时显示发送
  // （点发送会先停录音再发）。故录音且有内容时录音与发送并存，用户可二选一。
  const hasInput = input.trim().length > 0 || pendingImages.length > 0;
  // 同步结果阶段（服务端已出结论、正在拉详情）没有可停止的生成：不显示停止，发送仍禁用。
  const showStop = sending && streaming?.phase !== "syncing";
  const showMic = !sending && speech.supported && (speech.listening || !hasInput);
  const showSend = !sending && (hasInput || !speech.supported);

  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  // 草稿卡头部的分类 emoji：子分类没有独立图标，沿用一级分类的。
  const categoryIcons = useMemo(
    () => new Map((categoriesQuery.data ?? []).map((category) => [category.id, category.icon])),
    [categoriesQuery.data],
  );
  const conversationTitle = conversationId ? (conversationTitles[conversationId] ?? null) : null;

  const fillStarter = (text: string) => {
    setInput(text);
    // 等输入框按新内容撑开后再聚焦，光标落在末尾便于直接修改。
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  };

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
              categoryIcon={card.draft.categoryId ? categoryIcons.get(card.draft.categoryId) : null}
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
            categoryIcon={card.draft.categoryId ? categoryIcons.get(card.draft.categoryId) : null}
            confirming={confirmingKey === key && confirmDraft.isPending}
            key={key}
            onConfirm={() => {
              const target = currentTarget();
              if (!target) return;
              setConfirmingKey(key);
              confirmDraft.mutate({ message, cardIndex, target });
            }}
            onEdit={() => handleEdit(message.id, cardIndex)}
            onVoid={() => {
              const target = currentTarget();
              if (!target) return;
              setVoidingKey(key);
              voidDraft.mutate({ message, cardIndex, target });
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
          className="ai-nav mb-0!"
          leading={
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={() => router.back()}
            />
          }
          title={conversationTitle ?? "AI Agent"}
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
          ) : conversationLoadFailed ? (
            <EmptyState
              action={
                <Button onClick={() => setLoadAttempt((n) => n + 1)} variant="primary">
                  重试
                </Button>
              }
              message="网络不稳定或会话已不可用，可以重试，或新建对话。"
              title="会话加载失败"
            />
          ) : messages.length === 0 && !streaming ? (
            // 有进行中的轮次时（例如会话刚建、首次加载拿到空详情）不显示欢迎页，让轮次进度照常可见。
            <div className="ai-empty">
              <div className="ai-empty__intro">
                <span className="ai-empty__badge">
                  <Sparkles size={24} strokeWidth={2.1} />
                </span>
                <p className="ai-empty__title" suppressHydrationWarning>
                  {greeting()}，想记点什么？
                </p>
                <p className="ai-empty__hint">一句话记账、查账，草稿经你确认才入账。</p>
              </div>
              <div className="ai-starters">
                {visionEnabled ? (
                  <button
                    className="ai-starter"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <span
                      className="ai-starter__icon"
                      style={{ "--ai-starter-color": "oklch(0.62 0.17 290)" } as CSSProperties}
                    >
                      <ImagePlus size={18} />
                    </span>
                    <span className="ai-starter__body">
                      <span className="ai-starter__title">识别账单截图</span>
                      <span className="ai-starter__example">上传支付记录截图，批量生成草稿</span>
                    </span>
                    <ChevronRight className="ai-starter__chevron" size={18} />
                  </button>
                ) : null}
                {STARTERS.map(({ icon: Icon, color, title, example }) => (
                  <button
                    className="ai-starter"
                    key={title}
                    onClick={() => fillStarter(example)}
                    type="button"
                  >
                    <span
                      className="ai-starter__icon"
                      style={{ "--ai-starter-color": color } as CSSProperties}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="ai-starter__body">
                      <span className="ai-starter__title">{title}</span>
                      <span className="ai-starter__example">{example}</span>
                    </span>
                    <ChevronRight className="ai-starter__chevron" size={18} />
                  </button>
                ))}
              </div>
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
                        {streaming.phase === "syncing"
                          ? typing("正在同步结果…")
                          : streaming.phase === "stopping"
                            ? typing("正在停止…")
                            : streaming.phase === "recovering"
                              ? typing("连接中断，AI 仍在后台处理，完成后自动显示")
                              : holdDrafts
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
                  disabled={!hasInput || !conversationReady || compressing > 0}
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
          const { cardIndex, target, message: snapshot, token } = editingDraft;
          // 仍在原会话就用最新的消息，否则用打开时的快照（回写按 target 记到所属会话）。
          const message =
            messagesRef.current.find((item) => item.id === editingDraft.messageId) ?? snapshot;
          setEditingDraft((current) => (current?.token === token ? null : current));
          // 「已记一笔」与缓存刷新由表单负责，这里只回写卡片。
          const { synced } = await settleCard(message, cardIndex, transaction.id, target);
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
        <div className="flex flex-col pb-4">
          {conversationsQuery.isPending ? (
            <LoadingState rows={3} title="加载会话" />
          ) : conversations.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              还没有历史会话
            </p>
          ) : (
            <>
              {groupConversations(conversations).map((group) => (
                <div className="ai-history__group" key={group.label}>
                  <p className="ai-history__label">{group.label}</p>
                  {group.items.map((conversation) => (
                    <div
                      className={`ai-history__item${conversation.id === conversationId ? " is-active" : ""}`}
                      key={conversation.id}
                    >
                      <button
                        className="ai-history__open"
                        onClick={() => {
                          if (conversation.id !== conversationId) openConversation(conversation.id);
                          setHistoryOpen(false);
                        }}
                        type="button"
                      >
                        <span className="ai-history__title">
                          {conversation.title ?? "未命名会话"}
                        </span>
                        <span className="ai-history__time">
                          {conversationTime(conversation.updatedAt)}
                        </span>
                      </button>
                      <button
                        aria-label="删除会话"
                        className="ai-history__delete"
                        onClick={() => {
                          deleteConversation.mutate(conversation.id, {
                            onSuccess: () => {
                              if (conversation.id === conversationId) startNewConversation();
                            },
                          });
                        }}
                        title="删除会话"
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
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
