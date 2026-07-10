"use client";

import { useEffect, useState } from "react";

/** 桌面断点：≥1024px。见 DESKTOP_UI_PLAN.md 决策 D1。 */
export const DESKTOP_MIN_WIDTH = 1024;
const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

/**
 * 是否处于桌面断点。
 *
 * SSR / 首帧一律返回 `false`（移动壳），挂载后按 matchMedia 结果切换（D1）。
 * 页面数据本就客户端加载且有 loading 态，首帧到桌面的切换闪烁可接受。
 * 纯样式差异优先用 CSS 变体，仅结构分支才用本 hook。
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isDesktop;
}
