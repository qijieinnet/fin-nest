"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { usePreferences } from "@/providers";

export function SystemSettingsScreen() {
  const router = useRouter();
  const { preferences, setPreference } = usePreferences();

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="仅影响本设备的显示偏好"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="系统设置"
      >
        <div className="flex flex-col gap-3 pb-6">
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  账单页显示账本切换
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  开启后账单页「更多」中显示账本切换入口
                </span>
              </span>
              <Switch
                checked={preferences.showLedgerSwitcherOnBills}
                label="账单页显示账本切换"
                onCheckedChange={(checked) => setPreference("showLedgerSwitcherOnBills", checked)}
              />
            </div>
          </section>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
