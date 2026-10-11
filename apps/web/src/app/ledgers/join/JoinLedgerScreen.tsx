"use client";

import { ArrowLeft } from "lucide-react";
import { MobileAppShell, MobilePage } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { JoinLedgerForm } from "../_components/JoinLedgerSheet";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { t } from "@/lib/i18n";

export function JoinLedgerScreen() {
  const router = useAppRouter();

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <button
            aria-label={t("返回")}
            className="text-[var(--color-tint)]"
            onClick={() => router.back()}
            type="button"
          >
            <ArrowLeft size={20} />
          </button>
        }
        description={t("输入对方分享的邀请码申请加入账本")}
        title={t("加入账本")}
      >
        <JoinLedgerForm onSuccess={() => router.replace(routes.ledgers)} />
      </MobilePage>
    </MobileAppShell>
  );
}
