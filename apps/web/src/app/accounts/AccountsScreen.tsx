"use client";

import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { AccountsScreenDesktop } from "./AccountsScreen.desktop";
import { AccountsScreenMobile } from "./AccountsScreen.mobile";

/** 账户页断点分发：≥1024px 桌面主从布局，否则移动列表（D2）。 */
export function AccountsScreen() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <AccountsScreenDesktop /> : <AccountsScreenMobile />;
}
