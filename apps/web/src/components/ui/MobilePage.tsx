import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { NavigationBar } from "./NavigationBar";

type MobilePageProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  /** 内嵌宿主（如飞书 webview）自带页头时隐藏本页导航栏，仅保留状态栏安全区留白。 */
  hideNavigationBar?: boolean;
  leading?: ReactNode;
  navigationTitleAlign?: "center" | "left" | "right";
  navigationVariant?: "large" | "inline";
  title: string;
};

export function MobilePage({
  action,
  children,
  description,
  hideNavigationBar = false,
  leading,
  navigationTitleAlign = "center",
  navigationVariant = "inline",
  title,
}: MobilePageProps) {
  return (
    <main
      className={cn(
        "mobile-page min-h-dvh px-[var(--space-page-x)] pb-[calc(var(--space-tab-bar-height)+env(safe-area-inset-bottom))]",
        // 导航栏本身负责顶部安全区与 18px 下边距，隐藏后由 main 补上，避免内容顶到状态栏。
        hideNavigationBar ? "pt-[calc(env(safe-area-inset-top)+18px)]" : "pt-0",
      )}
    >
      {hideNavigationBar ? null : (
        <NavigationBar
          action={action}
          leading={leading}
          subtitle={description}
          title={title}
          titleAlign={navigationTitleAlign}
          variant={navigationVariant}
        />
      )}
      {children}
    </main>
  );
}
