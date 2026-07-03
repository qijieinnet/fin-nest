"use client";

import { CalendarDays, Home, MoreHorizontal, WalletCards } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { routes } from "@/lib/route/routes";
import { TabBar } from "./TabBar";

const TABS = [
  { value: routes.bills, label: "账单", icon: <Home size={20} /> },
  { value: routes.accounts, label: "账户", icon: <WalletCards size={20} /> },
  { value: routes.budget, label: "计划", icon: <CalendarDays size={20} /> },
  { value: routes.more, label: "更多", icon: <MoreHorizontal size={20} /> },
];

function activeTab(pathname: string): string {
  const match = TABS.find((tab) => pathname === tab.value || pathname.startsWith(`${tab.value}/`));
  return match?.value ?? routes.bills;
}

/** 全局底部导航：账单/账户/计划/更多，固定在 430px 容器底部居中。 */
export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const value = activeTab(pathname);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="relative w-[min(100vw,var(--space-app-width))]">
        <div className="pointer-events-auto absolute inset-x-3 bottom-[calc(14px+env(safe-area-inset-bottom))]">
          <TabBar
            items={TABS}
            onValueChange={(next) => {
              if (next !== value) router.push(next);
            }}
            value={value}
          />
        </div>
      </div>
    </div>
  );
}
