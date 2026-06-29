"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { MobileAppShell, MobilePage } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { JoinLedgerForm } from "../_components/JoinLedgerSheet";

export function JoinLedgerScreen() {
  const router = useRouter();

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <button
            aria-label="返回"
            className="text-[var(--color-tint)]"
            onClick={() => router.back()}
            type="button"
          >
            <ArrowLeft size={20} />
          </button>
        }
        description="输入对方分享的邀请码申请加入账本"
        title="加入账本"
      >
        <JoinLedgerForm onSuccess={() => router.replace(routes.ledgers)} />
      </MobilePage>
    </MobileAppShell>
  );
}
