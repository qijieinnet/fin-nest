"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage, type AiCard, type AiConversationDetail } from "@/lib/api";
import { AiServerError, streamAiChat } from "@/lib/data/ai";
import {
  cancelAiChatRun,
  fetchConsistentConversationDetail,
  listPendingAiRounds,
  removePendingAiRound,
  savePendingAiRound,
  updatePendingAiRound,
  waitForAiChatRun,
} from "@/lib/data/ai-chat-run";

/**
 * streaming：连接正常收流；recovering：连接已断，按 requestId 等服务端结果；stopping：已点停止；
 * syncing：服务端已出结论（done/lost），正在拉取一致的会话详情——此时已无可停止的生成，不提供停止。
 */
export type AiRoundPhase = "streaming" | "recovering" | "stopping" | "syncing";

/**
 * 一轮聊天（一次发送）。轮次归属于某个视图：已有会话时是会话 id；新对话视图是一个临时 key，
 * 收到 start 得知会话 id 后改挂到会话上。界面只渲染「当前视图」的那一轮，
 * 切走不影响它在后台继续，切回来接着显示。
 */
export type AiRound = {
  requestId: string;
  ledgerId: string;
  viewKey: string;
  conversationId: string | null;
  /** 本地乐观插入的用户消息 id；用户消息最终没落库时据此撤回。重载后恢复的轮次为空。 */
  localMessageId: string | null;
  userContent: string;
  content: string;
  cards: AiCard[];
  withImages: boolean;
  phase: AiRoundPhase;
};

export type AiRoundFinish = {
  conversationId: string;
  /** 本轮结束后的会话详情：拉取前后会话本地版本一致，可直接整体上屏（见 settle）。 */
  detail: AiConversationDetail;
};

export type AiRoundCallbacks = {
  /** 轮次得知了所属会话（start 事件或恢复查询）。previous 是改挂前的轮次（含原 viewKey）。 */
  onConversation: (previous: AiRound, conversationId: string) => void;
  /** 轮次结束且已有回复（含出错说明、停止生成），带一致的会话详情。 */
  onFinished: (round: AiRound, result: AiRoundFinish) => void;
  /** 用户消息没有落库（请求被拒或没到达服务端），本轮作废。 */
  onDiscarded: (round: AiRound) => void;
  notify: (tone: "error" | "success", message: string) => void;
  /**
   * 会话的本地更新版本：卡片确认/作废/改草稿、轮次收尾时递增。恢复拉详情前后各取一次，
   * 期间有更新则这份详情可能是旧快照，重拉（见 fetchConsistentConversationDetail）。
   */
  conversationVersion: (conversationId: string) => number;
};

/**
 * 流式请求被服务端明确拒绝、本轮确定没有落库（无需恢复）：4xx（重复提交、超时类除外），
 * 或没收到 start 就以 error 事件结束（落库前的校验/权限/限流错误）。
 * 5xx 与反代错误不算：请求可能已到达并在跑；重复提交说明原轮次存在，应恢复它。
 */
function isRejectedBeforeStart(error: AiServerError): boolean {
  if (error.code === "AI_DUPLICATE_REQUEST") return false;
  if (error.status === undefined) return true;
  return error.status >= 400 && error.status < 500 && error.status !== 408;
}

// 连续查到「用户消息未落库」多久就认定请求没到达服务端；点了停止时很快就能下结论。
const UNKNOWN_GRACE_MS = 20_000;
const UNKNOWN_GRACE_STOPPING_MS = 3_000;

/** 一轮流式聊天的 requestId（UUID v4）。crypto.randomUUID 仅限安全上下文，局域网 http 访问时手工拼。 */
function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * AI 聊天的轮次管理：发送、流式增量、断连后按 requestId 恢复、显式停止、重载后续接。
 *
 * 服务端不随连接断开中止本轮（iOS 切到别的 App 会掐断请求），所以这里：
 * - 收到 done/error 之外的任何中断都转入恢复：轮询 GET /ai/chat/stream/:requestId 直到终态；
 * - 「停止」= 断开本地流 + 调取消接口，结论仍以轮次状态为准；
 * - 待恢复轮次记在 sessionStorage，组件卸载只停客户端任务，再次挂载时继续恢复。
 */
export function useAiChatRounds(ledgerId: string | null, callbacks: AiRoundCallbacks) {
  // storeRef 是同步可读的事实来源（异步回调里要读最新值），rounds 只用于触发渲染。
  const storeRef = useRef<Record<string, AiRound>>({});
  const [rounds, setRounds] = useState<Record<string, AiRound>>({});
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  // 每轮的客户端任务：life 在卸载/放弃时中止（停轮询、停收流），stream 只断本地流。
  const controlsRef = useRef(new Map<string, { life: AbortController; stream: AbortController }>());
  const stopSeqRef = useRef(new Map<string, number>());

  const commit = useCallback((next: Record<string, AiRound>) => {
    storeRef.current = next;
    setRounds(next);
  }, []);

  const patch = useCallback(
    (requestId: string, update: (round: AiRound) => AiRound) => {
      const round = storeRef.current[requestId];
      if (!round) return;
      commit({ ...storeRef.current, [requestId]: update(round) });
    },
    [commit],
  );

  /** 结束本轮的客户端状态。keepPending：保留待恢复记录，下次挂载继续。 */
  const drop = useCallback(
    (requestId: string, keepPending = false): AiRound | undefined => {
      const round = storeRef.current[requestId];
      const controls = controlsRef.current.get(requestId);
      controls?.life.abort();
      controls?.stream.abort();
      controlsRef.current.delete(requestId);
      stopSeqRef.current.delete(requestId);
      if (!keepPending) removePendingAiRound(requestId);
      if (round) {
        const next = { ...storeRef.current };
        delete next[requestId];
        commit(next);
      }
      return round;
    },
    [commit],
  );

  const bindConversation = useCallback(
    (requestId: string, conversationId: string) => {
      const previous = storeRef.current[requestId];
      if (!previous || previous.conversationId === conversationId) return;
      patch(requestId, (round) => ({ ...round, conversationId, viewKey: conversationId }));
      updatePendingAiRound(requestId, { conversationId });
      callbacksRef.current.onConversation(previous, conversationId);
    },
    [patch],
  );

  /**
   * 一轮的唯一收尾方式（流式正常结束与断连恢复都走这里）：进入 syncing，拉一份「拉取前后会话本地
   * 版本一致」的详情，拿到后在同一同步段内结束本轮并整体上屏。会话详情是消息列表的唯一来源，
   * 不再在本地追加回复——多种更新方式并存正是此前各种覆盖竞态的根源。
   * syncing 期间本轮仍占着视图（禁止发送、不提供停止），所以整体上屏不会冲掉本地新内容。
   */
  const settle = useCallback(
    async (requestId: string, conversationId: string, lost: boolean) => {
      const life = controlsRef.current.get(requestId)?.life;
      const initial = storeRef.current[requestId];
      if (!life || !initial) return;
      const notify = callbacksRef.current.notify;
      bindConversation(requestId, conversationId);
      patch(requestId, (current) => ({ ...current, phase: "syncing" }));
      try {
        const detail = await fetchConsistentConversationDetail(initial.ledgerId, conversationId, {
          signal: life.signal,
          version: () => callbacksRef.current.conversationVersion(conversationId),
        });
        if (life.signal.aborted) return;
        if (!detail) {
          // 前台持续拉不到：先不占着界面，保留待恢复记录，下次进入 AI 页续接（服务端已有结果）。
          notify("error", "网络异常，AI 的结果稍后会显示在这个对话里");
          drop(requestId, true);
          return;
        }
        if (lost) notify("error", "这条消息的处理意外中断了，请重新发送");
        const round = drop(requestId);
        if (round) callbacksRef.current.onFinished(round, { conversationId, detail });
      } catch (error) {
        if (life.signal.aborted) return;
        // 确定性拒绝（登录失效/无权限/会话不存在）：停止等待，不撤回本地消息，也不整体重载会话。
        notify("error", getApiErrorMessage(error) || "无法获取这条消息的结果");
        drop(requestId);
      }
    },
    [bindConversation, drop, patch],
  );

  const recover = useCallback(
    async (requestId: string) => {
      const life = controlsRef.current.get(requestId)?.life;
      const initial = storeRef.current[requestId];
      if (!life || !initial) return;
      const { ledgerId: roundLedgerId } = initial;
      patch(requestId, (round) =>
        round.phase === "stopping" ? round : { ...round, phase: "recovering" },
      );
      const notify = callbacksRef.current.notify;
      try {
        const terminal = await waitForAiChatRun(roundLedgerId, requestId, {
          signal: life.signal,
          unknownGraceMs: () =>
            storeRef.current[requestId]?.phase === "stopping"
              ? UNKNOWN_GRACE_STOPPING_MS
              : UNKNOWN_GRACE_MS,
          onStatus: (status) => {
            if ("conversationId" in status && status.conversationId) {
              bindConversation(requestId, status.conversationId);
            }
          },
        });
        if (life.signal.aborted) return;
        if (terminal.state === "done" || terminal.state === "lost") {
          await settle(requestId, terminal.conversationId, terminal.state === "lost");
          return;
        }
        if (terminal.state === "unknown") {
          const round = drop(requestId);
          if (round && round.phase !== "stopping") notify("error", "发送失败，请重新发送");
          if (round) callbacksRef.current.onDiscarded(round);
          return;
        }
        // unreachable：先不占着界面，保留待恢复记录，下次进入 AI 页继续。
        notify("error", "网络异常，AI 的结果稍后会显示在这个对话里");
        drop(requestId, true);
      } catch (error) {
        if (life.signal.aborted) return;
        // 确定性拒绝（登录失效/无权限/会话不存在）：停止等待。用户消息可能已落库，不撤回本地消息，
        // 也不去整体重载会话（无权读取，且会冲掉本地内容）。
        notify("error", getApiErrorMessage(error) || "无法获取这条消息的结果");
        drop(requestId);
      }
    },
    [bindConversation, drop, patch, settle],
  );

  const send = useCallback(
    (input: {
      viewKey: string;
      conversationId: string | null;
      content: string;
      images: Blob[];
      localMessageId: string;
    }) => {
      if (!ledgerId) return;
      const requestId = newRequestId();
      const round: AiRound = {
        requestId,
        ledgerId,
        viewKey: input.viewKey,
        conversationId: input.conversationId,
        localMessageId: input.localMessageId,
        userContent: input.content,
        content: "",
        cards: [],
        withImages: input.images.length > 0,
        phase: "streaming",
      };
      const life = new AbortController();
      const stream = new AbortController();
      controlsRef.current.set(requestId, { life, stream });
      commit({ ...storeRef.current, [requestId]: round });
      savePendingAiRound({
        ledgerId,
        requestId,
        conversationId: input.conversationId,
        withImages: round.withImages,
        createdAt: Date.now(),
      });

      void (async () => {
        let started = false;
        try {
          const result = await streamAiChat(
            ledgerId,
            {
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              content: input.content,
              images: input.images,
              requestId,
            },
            {
              onStart: (info) => {
                started = true;
                bindConversation(requestId, info.conversationId);
              },
              onDelta: (text) =>
                patch(requestId, (current) => ({ ...current, content: current.content + text })),
              onCard: (card) =>
                patch(requestId, (current) => ({ ...current, cards: [...current.cards, card] })),
            },
            stream.signal,
          );
          if (life.signal.aborted) return;
          // 流式正常结束同样以会话详情收尾（不在本地追加 result.message），见 settle。
          await settle(requestId, result.conversationId, false);
        } catch (error) {
          if (life.signal.aborted) return;
          if (error instanceof AiServerError) {
            if (!started && isRejectedBeforeStart(error)) {
              // 服务端明确拒绝、用户消息没落库：撤回本地消息，不必恢复。
              callbacksRef.current.notify("error", error.message);
              const discarded = drop(requestId);
              if (discarded) callbacksRef.current.onDiscarded(discarded);
              return;
            }
            // 已落库（服务端写了出错说明）、5xx/反代错误（服务端可能已在跑）、重复提交（原轮次存在）：
            // 一律按 requestId 恢复，以轮次状态为准。
            if (started) callbacksRef.current.notify("error", error.message);
          }
          await recover(requestId);
        }
      })();
    },
    [bindConversation, commit, drop, ledgerId, patch, recover, settle],
  );

  const stop = useCallback(
    async (requestId: string) => {
      const round = storeRef.current[requestId];
      const controls = controlsRef.current.get(requestId);
      // 同步结果阶段服务端已结束本轮，取消没有意义。
      if (!round || !controls || round.phase === "syncing") return;
      // 多次点停止只认最后一次：较早那次的迟到失败不能回退阶段。
      const seq = (stopSeqRef.current.get(requestId) ?? 0) + 1;
      stopSeqRef.current.set(requestId, seq);
      const previousPhase = round.phase === "stopping" ? "recovering" : round.phase;
      patch(requestId, (current) => ({ ...current, phase: "stopping" }));
      // 断开本地流：收流中的轮次随即转入恢复（stopping 下很快得出结论）。
      controls.stream.abort();
      try {
        // 取消请求也受本轮生命周期约束：卸载/本轮已结束后不再回调。
        await cancelAiChatRun(round.ledgerId, requestId, controls.life.signal);
      } catch {
        if (controls.life.signal.aborted || controlsRef.current.get(requestId) !== controls) return;
        // 取消失败时只有仍停在本次设置的 stopping 才回退：期间服务端已出结论进入 syncing 等，保持现状。
        const current = storeRef.current[requestId];
        if (current?.phase !== "stopping" || stopSeqRef.current.get(requestId) !== seq) return;
        callbacksRef.current.notify("error", "停止失败，请重试");
        patch(requestId, (current) => ({
          ...current,
          phase: previousPhase === "streaming" ? "recovering" : previousPhase,
        }));
      }
    },
    [patch],
  );

  // 进入页面（或切换账本）时续接 sessionStorage 里未结束的轮次。
  useEffect(() => {
    if (!ledgerId) return;
    for (const pending of listPendingAiRounds(ledgerId)) {
      if (storeRef.current[pending.requestId]) continue;
      controlsRef.current.set(pending.requestId, {
        life: new AbortController(),
        stream: new AbortController(),
      });
      commit({
        ...storeRef.current,
        [pending.requestId]: {
          requestId: pending.requestId,
          ledgerId,
          // 会话未知时挂在一个不会被展示的视图上，查到会话后改挂。
          viewKey: pending.conversationId ?? `pending:${pending.requestId}`,
          conversationId: pending.conversationId,
          localMessageId: null,
          userContent: "",
          content: "",
          cards: [],
          withImages: pending.withImages,
          phase: "recovering",
        },
      });
      void recover(pending.requestId);
    }
  }, [commit, ledgerId, recover]);

  // 卸载：只停客户端任务（不取消服务端），待恢复记录保留，重新挂载时续接。
  useEffect(() => {
    const controls = controlsRef.current;
    return () => {
      for (const { life, stream } of controls.values()) {
        life.abort();
        stream.abort();
      }
      controls.clear();
      storeRef.current = {};
    };
  }, []);

  const roundForView = useCallback(
    (viewKey: string) =>
      Object.values(rounds).find(
        (round) => round.viewKey === viewKey && round.ledgerId === ledgerId,
      ) ?? null,
    [ledgerId, rounds],
  );

  return { roundForView, send, stop };
}
