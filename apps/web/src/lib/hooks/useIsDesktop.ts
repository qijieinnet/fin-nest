"use client";

import { useSyncExternalStore } from "react";

/** 桌面断点：≥1024px。见 DESKTOP_UI_PLAN.md 决策 D1。 */
export const DESKTOP_MIN_WIDTH = 1024;
const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** SSR 快照恒为 false（移动壳），与首屏 HTML 保持一致，避免 hydration mismatch。 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * 是否处于桌面断点。
 *
 * 用 useSyncExternalStore 在渲染期同步读取 matchMedia：客户端路由切换（点菜单）
 * 时无 SSR，首帧即得真实值，不再闪一下移动壳（D1）。仅首次硬加载因 SSR 必须默认
 * 移动壳而有一次不可避免的切换。
 *
 * 纯样式差异优先用 CSS 变体，仅结构分支才用本 hook。
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
