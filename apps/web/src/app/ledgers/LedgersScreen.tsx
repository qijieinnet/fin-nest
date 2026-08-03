"use client";

import { ChevronLeft, Plus } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/business";
import { IconButton, Button, MobileAppShell, MobilePage, MobileTabBar } from "@/components/ui";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { useIsPrimaryNavMenu } from "@/lib/nav/useNavMenuPlacement";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useAuth, useLedger, useSheetStack } from "@/providers";
import { CreateLedgerSheet } from "./_components/CreateLedgerSheet";
import { JoinLedgerSheet } from "./_components/JoinLedgerSheet";
import { LedgerCard } from "./_components/LedgerCard";
import { LedgerDetailSheet } from "./_components/LedgerDetailSheet";

export function LedgersScreen() {
  const router = useAppRouter();
  const { user } = useAuth();
  const { isLoading, ledgerId, ledgers } = useLedger();
  const { push } = useSheetStack();
  const isDesktop = useIsDesktop();
  // 用户把「账本」放到导航栏时作为一级页（内嵌底部导航、无返回）；在「更多」里则全屏 + 返回。
  const isPrimary = useIsPrimaryNavMenu("ledgers");

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const openCreate = () => {
    push({ hideDefaultHeader: true, content: <CreateLedgerSheet /> });
  };

  const openDetail = (id: string) => {
    push({ hideDefaultHeader: true, content: <LedgerDetailSheet ledgerId={id} /> });
  };

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新建账本"
            onClick={openCreate}
          />
        }
        description={user ? `${user.alias} · ${user.account}` : undefined}
        leading={
          isDesktop || !isPrimary ? (
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={goBack}
            />
          ) : undefined
        }
        navigationTitleAlign="left"
        navigationVariant="large"
        title="账本管理"
      >
        <div className="flex flex-col">
          <p className="px-1.5 pb-2.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
            当前账本决定账单、统计、账户等数据展示。点击账本可查看详情、切换、分享或管理成员。
          </p>

          {isLoading ? (
            <LoadingState rows={3} title="加载账本" />
          ) : ledgers.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={openCreate} variant="primary">
                  新建账本
                </Button>
              }
              message="创建一个账本开始记账，或通过邀请码加入他人账本。"
              title="还没有账本"
            />
          ) : (
            <div className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              {ledgers.map((ledger) => (
                <LedgerCard
                  isCurrent={ledger.id === ledgerId}
                  isOwner={ledger.ownerUserId === user?.id}
                  key={ledger.id}
                  ledger={ledger}
                  onOpenDetail={() => openDetail(ledger.id)}
                />
              ))}
            </div>
          )}

          <Button
            className="mt-3.5 w-full !bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            onClick={() => push({ hideDefaultHeader: true, content: <JoinLedgerSheet /> })}
            variant="secondary"
          >
            输入邀请码加入账本
          </Button>
        </div>
      </MobilePage>
      {isPrimary ? <MobileTabBar /> : null}
    </MobileAppShell>
  );
}
