"use client";

import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { PlansScreenDesktop } from "./PlansScreen.desktop";
import { PlansScreenMobile } from "./PlansScreen.mobile";

/** 计划页断点分发：≥1024px 桌面卡片网格，否则移动版（D2）。 */
export function PlansScreen() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <PlansScreenDesktop /> : <PlansScreenMobile />;
}
