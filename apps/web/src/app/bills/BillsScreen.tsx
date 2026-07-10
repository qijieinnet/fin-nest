"use client";

import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { BillsScreenDesktop } from "./BillsScreen.desktop";
import { BillsScreenMobile } from "./BillsScreen.mobile";

/** 账单页断点分发：≥1024px 桌面主从布局（表格+详情），否则移动列表（D2）。 */
export function BillsScreen() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <BillsScreenDesktop /> : <BillsScreenMobile />;
}
