"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, MobileAppShell, MobilePage } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, getApiErrorMessage } from "@/lib/api";
import { routes } from "@/lib/route/routes";
import { useAuth, useLedger, useSheetStack, useToast } from "@/providers";
import { CreateLedgerSheet } from "./_components/CreateLedgerSheet";
import { LedgerCard } from "./_components/LedgerCard";
import { LedgerDetailSheet } from "./_components/LedgerDetailSheet";

export function LedgersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, clearUser } = useAuth();
  const { clearLedger, isLoading, ledgerId, ledgers, setLedgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();

  const logout = useMutation({
    mutationFn: () => apiRequest<void>(API_ENDPOINTS.logout, { method: "POST" }),
    onSettled: () => {
      clearLedger();
      clearUser();
      queryClient.clear();
      router.replace(routes.login);
    },
  });

  const openCreate = () => {
    push({ title: "新建账本", content: <CreateLedgerSheet /> });
  };

  const openDetail = (id: string) => {
    push({ title: "账本详情", content: <LedgerDetailSheet ledgerId={id} /> });
  };

  const switchLedger = (id: string) => {
    if (id === ledgerId) return;
    setLedgerId(id);
    const next = ledgers.find((ledger) => ledger.id === id);
    showToast({ tone: "success", message: `已切换到「${next?.name ?? "账本"}」` });
  };

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <button
            className="text-sm font-medium text-[var(--color-tint)]"
            onClick={openCreate}
            type="button"
          >
            新建
          </button>
        }
        description={user ? `${user.alias} · ${user.account}` : undefined}
        title="账本"
      >
        <div className="flex flex-col gap-4">
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
            <ul className="flex flex-col gap-3">
              {ledgers.map((ledger) => (
                <li key={ledger.id}>
                  <LedgerCard
                    isCurrent={ledger.id === ledgerId}
                    isOwner={ledger.ownerUserId === user?.id}
                    ledger={ledger}
                    onOpenDetail={() => openDetail(ledger.id)}
                    onSelect={() => switchLedger(ledger.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-col gap-3">
            <Button onClick={() => router.push(routes.ledgersJoin)} variant="secondary">
              通过邀请码加入账本
            </Button>
            <Button
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              variant="ghost"
            >
              {logout.isPending ? "退出中…" : "退出登录"}
            </Button>
            {logout.isError ? (
              <p className="text-center text-xs text-[var(--color-accent-expense)]">
                {getApiErrorMessage(logout.error)}
              </p>
            ) : null}
          </div>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
