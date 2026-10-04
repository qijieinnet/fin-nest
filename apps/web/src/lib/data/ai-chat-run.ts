"use client";

import {
  aiChatStreamCancelPath,
  aiConversationPath,
  aiChatStreamRunPath,
  apiRequest,
  isApiClientError,
  type AiChatRunStatus,
  type AiConversationDetail,
} from "@/lib/api";

/**
 * 流式聊天断连恢复。
 *
 * iOS Safari 切到别的 App 会直接掐断页面上的请求（报 Load failed），而识图一轮动辄几十秒。
 * 服务端因此不随断连中止，本轮照常跑完落库；前端凭发送时生成的 requestId 查轮次状态
 * （GET /ai/chat/stream/:requestId），拿到确定终态再上屏。待恢复的轮次记在 sessionStorage，
 * 离开 AI 页或页面被系统回收重载后回来也能接着恢复。
 */

const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;
// 前台持续查不通这么久就先放弃等待（轮次仍记在待恢复列表里，下次进入 AI 页继续）。
const UNREACHABLE_AFTER_MS = 2 * 60_000;
// 待恢复记录的保留上限：远超任何一轮可能的时长，过期即丢弃。
const PENDING_TTL_MS = 2 * 60 * 60_000;
const PENDING_STORAGE_KEY = "fin-nest.ai-pending-rounds";

export type AiChatRunTerminal =
  | Extract<AiChatRunStatus, { state: "done" | "lost" }>
  /** 用户消息始终没有落库：请求没到达服务端（或在登记前就被取消），不会再有结果。 */
  | { state: "unknown" }
  /** 前台持续查不通，暂时放弃等待。 */
  | { state: "unreachable" };

/** 合并多个 AbortSignal（AbortSignal.any 在 iOS 17.4 以下不可用，手写一个）。 */
export function linkSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
  }
  return { signal: controller.signal, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

/** 单次请求带独立超时：挂住的请求不会卡死轮询，外部 signal 中止时一并中止。 */
async function requestWithTimeout<T>(
  path: string,
  init: { method?: "GET" | "POST" },
  signal?: AbortSignal,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("请求超时")), REQUEST_TIMEOUT_MS);
  const linked = linkSignals(signal, timeout.signal);
  try {
    return await apiRequest<T>(path, { ...init, signal: linked.signal });
  } finally {
    clearTimeout(timer);
    linked.dispose();
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** 等待 ms 毫秒；页面在后台时一直等到切回前台。切回前台会提前结束等待。 */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const onVisibility = () => {
      if (isVisible()) finish();
    };
    if (isVisible()) timer = setTimeout(finish, ms);
    document.addEventListener("visibilitychange", onVisibility);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 服务端给出的确定性拒绝（登录失效/无账本权限/账本不存在）：再查也不会变。
 * 其余错误（含偶发 4xx/5xx、超时、断网）一律当暂时性的继续重试——服务端很可能仍在处理。
 */
function isPermanentError(error: unknown): boolean {
  return isApiClientError(error) && [401, 403, 404].includes(error.status);
}

/**
 * 轮询轮次状态直到终态。页面在后台不发请求、切回前台立即查；每次请求有独立超时；
 * signal 中止（组件卸载）即停止并抛出中止错误；确定性拒绝原样抛出。
 * unknownGraceMs：连续处于 unknown（用户消息未落库）多久后认定请求没有到达服务端。
 */
export async function waitForAiChatRun(
  ledgerId: string,
  requestId: string,
  options: {
    signal: AbortSignal;
    /** 可传函数：等待途中点了「停止」时宽限期会缩短。 */
    unknownGraceMs: number | (() => number);
    onStatus?: (status: AiChatRunStatus) => void;
  },
): Promise<AiChatRunTerminal> {
  const { signal, unknownGraceMs, onStatus } = options;
  // 两个计时都只累计「前台」时间：任何一次可见性变化（进/出后台，无论发生在请求途中还是
  // 两次轮询之间）都把它们清零重来，后台挂起的时长不会让人刚切回来就被判定查不通/没发出去。
  let unknownSince: number | null = null;
  let lastReachable = Date.now();
  // 当前这次状态查询：进入后台即中止。iOS 冻结后台页面时，挂着的请求可能在「回到前台」事件之前
  // 才失败回调，若照常判定就会把后台冻结的时长算成「查不通」；中止后这次结果一律不参与判定。
  let inflight: AbortController | null = null;
  const onVisibility = () => {
    lastReachable = Date.now();
    unknownSince = null;
    if (!isVisible()) inflight?.abort(new Error("页面进入后台"));
  };
  document.addEventListener("visibilitychange", onVisibility);
  try {
    return await pollUntilTerminal();
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
  }

  async function pollUntilTerminal(): Promise<AiChatRunTerminal> {
    for (;;) {
      if (signal.aborted) throw abortError(signal);
      if (!isVisible()) {
        await pause(POLL_INTERVAL_MS, signal);
        continue;
      }
      const request = new AbortController();
      inflight = request;
      const linked = linkSignals(signal, request.signal);
      try {
        const status = await requestWithTimeout<AiChatRunStatus>(
          aiChatStreamRunPath(ledgerId, requestId),
          { method: "GET" },
          linked.signal,
        );
        onStatus?.(status);
        // done/lost 是服务端事实，前后台都可直接收下。
        if (status.state === "done" || status.state === "lost") return status;
        // 其余结论都依赖计时：请求途中进过后台或当前仍在后台，这次不作判定。
        if (request.signal.aborted || !isVisible()) continue;
        lastReachable = Date.now();
        if (status.state === "unknown") {
          unknownSince ??= Date.now();
          const grace = typeof unknownGraceMs === "function" ? unknownGraceMs() : unknownGraceMs;
          if (Date.now() - unknownSince >= grace) return { state: "unknown" };
        } else {
          unknownSince = null;
        }
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        if (isPermanentError(error)) throw error;
        if (request.signal.aborted || !isVisible()) continue;
        if (Date.now() - lastReachable >= UNREACHABLE_AFTER_MS) return { state: "unreachable" };
      } finally {
        linked.dispose();
        if (inflight === request) inflight = null;
      }
      await pause(POLL_INTERVAL_MS, signal);
    }
  }
}

/**
 * 恢复收尾：拉一份「拉取前后会话本地版本一致」的详情。期间若本地有更新（确认/作废卡片等，
 * version 递增），这份可能是旧快照，立即重拉；网络失败等一会儿再拉（后台不请求）。
 * 前台连续失败超过 giveUpAfterMs（默认 2 分钟）返回 null；确定性拒绝原样抛出；signal 中止即停止。
 * 调用方在拿到结果之前不结束本轮，界面保持「恢复中」、不能发新消息，所以拿到的详情可以直接整体上屏。
 */
export async function fetchConsistentConversationDetail(
  ledgerId: string,
  conversationId: string,
  options: {
    signal: AbortSignal;
    version: () => number;
    /** 前台连续失败多久放弃（返回 null）。轮次收尾默认 2 分钟；打开会话的首次加载宜短，尽快给出「重试」。 */
    giveUpAfterMs?: number;
  },
): Promise<AiConversationDetail | null> {
  const { signal, version, giveUpAfterMs = UNREACHABLE_AFTER_MS } = options;
  // 与 waitForAiChatRun 相同的可见性处理：失败计时只累计前台时间（任何可见性变化都清零）；
  // 进入后台即中止进行中的请求，这次结果不参与判定，回到前台立即重试。
  let failingSince: number | null = null;
  let inflight: AbortController | null = null;
  const onVisibility = () => {
    failingSince = null;
    if (!isVisible()) inflight?.abort(new Error("页面进入后台"));
  };
  document.addEventListener("visibilitychange", onVisibility);
  try {
    for (;;) {
      if (signal.aborted) throw abortError(signal);
      if (!isVisible()) {
        await pause(POLL_INTERVAL_MS, signal);
        continue;
      }
      const before = version();
      const request = new AbortController();
      inflight = request;
      const linked = linkSignals(signal, request.signal);
      try {
        const detail = await fetchAiConversationDetail(ledgerId, conversationId, linked.signal);
        // 期间会话有本地更新：这份可能是旧快照，重拉。
        if (version() === before) return detail;
        failingSince = null;
        continue;
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        if (isPermanentError(error)) throw error;
        if (request.signal.aborted || !isVisible()) continue;
        failingSince ??= Date.now();
        if (Date.now() - failingSince >= giveUpAfterMs) return null;
      } finally {
        linked.dispose();
        if (inflight === request) inflight = null;
      }
      await pause(POLL_INTERVAL_MS, signal);
    }
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
  }
}

/** 拉会话详情（恢复收尾用），带单次超时，受 signal 约束。 */
export function fetchAiConversationDetail(
  ledgerId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<AiConversationDetail> {
  return requestWithTimeout<AiConversationDetail>(
    aiConversationPath(ledgerId, conversationId),
    { method: "GET" },
    signal,
  );
}

/**
 * 显式停止一轮（服务端不随断连中止，所以必须凭 requestId 通知）。失败抛出，由调用方提示重试。
 * 本轮已结束或从未开始时服务端也返回成功；是否真的停下以随后的轮次状态为准。
 */
export async function cancelAiChatRun(
  ledgerId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<void> {
  await requestWithTimeout<{ ok: boolean }>(
    aiChatStreamCancelPath(ledgerId, requestId),
    { method: "POST" },
    signal,
  );
}

export type PendingAiRound = {
  ledgerId: string;
  requestId: string;
  conversationId: string | null;
  withImages: boolean;
  createdAt: number;
};

function readPending(): PendingAiRound[] {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as PendingAiRound[]) : [];
    const now = Date.now();
    return Array.isArray(list) ? list.filter((item) => now - item.createdAt < PENDING_TTL_MS) : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingAiRound[]): void {
  try {
    if (list.length > 0) sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(list));
    else sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // 存储不可用时只是失去「重载后恢复」，当前页内恢复不受影响
  }
}

export function listPendingAiRounds(ledgerId: string): PendingAiRound[] {
  return readPending().filter((item) => item.ledgerId === ledgerId);
}

export function savePendingAiRound(round: PendingAiRound): void {
  writePending([...readPending().filter((item) => item.requestId !== round.requestId), round]);
}

export function updatePendingAiRound(
  requestId: string,
  patch: Partial<Pick<PendingAiRound, "conversationId">>,
): void {
  writePending(
    readPending().map((item) => (item.requestId === requestId ? { ...item, ...patch } : item)),
  );
}

export function removePendingAiRound(requestId: string): void {
  writePending(readPending().filter((item) => item.requestId !== requestId));
}
