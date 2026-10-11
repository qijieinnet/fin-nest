"use client";

import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/business";
import { MobileAppShell, MobilePage, MobileTabBar } from "@/components/ui";
import { t } from "@/lib/i18n";

/** 尚未实现的标签页占位（账户/统计/预算/更多将分别由 F5/F6/F7 实现）。 */
export function ComingSoonScreen({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <MobileAppShell>
      <MobilePage title={title}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <EmptyState icon={<Hammer size={28} />} message={subtitle} title={t("即将上线")} />
        </div>
      </MobilePage>
      <MobileTabBar />
    </MobileAppShell>
  );
}
