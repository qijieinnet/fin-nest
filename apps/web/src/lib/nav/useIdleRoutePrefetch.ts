"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 空闲时预取一组路由的代码与 RSC payload（仅生产构建生效，开发模式为 no-op）。
 * 导航用的是 button + router.push 而非 <Link>，Next 不会自动预取；不预取时
 * 首次点击菜单需现场下载目标页 chunk，观感像卡住。挂在 TabBar / Sidebar 上，
 * 让用户点击前目标路由已就绪。重复调用由 Next 客户端路由缓存去重，代价极低。
 */
export function useIdleRoutePrefetch(routesToPrefetch: readonly string[]): void {
  const router = useRouter();
  // 调用方每次渲染都会新建数组，用内容签名做依赖，避免重复调度；去重后再拼签名，
  // 兼容多份名单（一级导航 + SECONDARY_PREFETCH_ROUTES）可能重叠的情形。
  const signature = [...new Set(routesToPrefetch)].join("|");

  useEffect(() => {
    if (!signature) return;
    const prefetchAll = () => {
      for (const route of signature.split("|")) router.prefetch(route);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(prefetchAll, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetchAll, 300);
    return () => window.clearTimeout(id);
  }, [router, signature]);
}
