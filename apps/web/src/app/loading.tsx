import { LoadingState } from "@/components/business";
import { MobileAppShell } from "@/components/ui";

/**
 * 根路由加载态：客户端导航时目标页 chunk / RSC 尚未就绪的空窗期立即渲染，
 * 让切页始终有即时视觉反馈（配合 TabBar / Sidebar 的乐观高亮）。
 * 用 MobileAppShell 保持与各页一致的容器背景，避免闪白。
 */
export default function RootLoading() {
  return (
    <MobileAppShell>
      <main className="mobile-page min-h-dvh px-[var(--space-page-x)] pt-6">
        <LoadingState rows={6} />
      </main>
    </MobileAppShell>
  );
}
