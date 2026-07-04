"use client";

import { cn } from "@/lib/format/class-names";
import { usePageScrolled } from "./usePageScrolled";

/**
 * 主页面（含底部 TabBar）上下边缘的渐隐蒙层：内容滚动到边缘时柔和淡出。
 * 固定定位、限制在 App 容器宽度内并居中，pointer-events-none 不拦截点击。
 * 层级 z-20：位于滚动内容之上、浮动按钮栈/TabBar 之下。
 */
export function EdgeFade() {
  const scrolled = usePageScrolled();

  return (
    <>
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center transition-opacity duration-200",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="h-[calc(env(safe-area-inset-top)+24px)] w-[min(100vw,var(--space-app-width))] bg-[linear-gradient(to_bottom,var(--color-bg-app),rgba(254,254,254,0))]" />
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center">
        <div className="h-[calc(var(--space-tab-bar-height)+56px+env(safe-area-inset-bottom))] w-[min(100vw,var(--space-app-width))] bg-[linear-gradient(to_top,var(--color-bg-app),rgba(254,254,254,0))]" />
      </div>
    </>
  );
}
