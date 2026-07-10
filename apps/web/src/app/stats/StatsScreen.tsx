"use client";

import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { StatsScreenDesktop } from "./StatsScreen.desktop";
import { StatsScreenMobile } from "./StatsScreen.mobile";

/** 统计页断点分发：≥1024px 桌面 dashboard，否则移动版（D2）。 */
export function StatsScreen() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <StatsScreenDesktop /> : <StatsScreenMobile />;
}
