"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Button } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  type LedgerInvite,
  ledgerInvitesPath,
  ledgerPath,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useAuth, useLedger, useSheetStack, useToast } from "@/providers";
import { CreateLedgerSheet } from "./CreateLedgerSheet";
import { JoinRequestsSection } from "./JoinRequestsSection";
import { MembersSection } from "./MembersSection";
import { ShareInviteSheet } from "./ShareInviteSheet";

export function LedgerDetailSheet({ ledgerId }: { ledgerId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { ledgerId: currentLedgerId, ledgers, setLedgerId } = useLedger();
  const { pop, push } = useSheetStack();
  const { showToast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const ledger = ledgers.find((item) => item.id === ledgerId);

  const createInvite = useMutation({
    mutationFn: () =>
      apiRequest<LedgerInvite>(ledgerInvitesPath(ledgerId), { method: "POST", body: {} }),
    onSuccess: (invite) => {
      push({ title: "邀请码", content: <ShareInviteSheet invite={invite} /> });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  const deleteLedger = useMutation({
    mutationFn: () => apiRequest<void>(ledgerPath(ledgerId), { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      showToast({ tone: "success", message: "账本已删除" });
      pop();
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  if (!ledger) {
    return <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">账本不存在或已删除。</p>;
  }

  const isOwner = ledger.ownerUserId === user?.id;
  const isCurrent = ledger.id === currentLedgerId;
  const iconText = ledger.icon?.trim() || ledger.name.slice(0, 1);
  const whiteButtonClass = "!bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]";

  return (
    <div className="flex flex-col gap-5 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          账本详情
        </h2>
        {isOwner ? (
          <IconButton
            icon={<Pencil size={20} strokeWidth={2.2} />}
            label="编辑账本"
            onClick={() => push({ hideDefaultHeader: true, content: <CreateLedgerSheet ledger={ledger} /> })}
          />
        ) : (
          <span aria-hidden />
        )}
      </div>

      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--color-tint-soft)] text-xl font-semibold text-[var(--color-tint)]"
        >
          {iconText}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-[var(--color-text-primary)]">
            {ledger.name}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {isOwner ? "所有者" : "成员"} · {ledger.currency}
          </p>
        </div>
      </header>

      {isOwner ? <JoinRequestsSection ledgerId={ledger.id} /> : null}

      <MembersSection currentUserId={user?.id} isOwner={isOwner} ledgerId={ledger.id} />

      {!isCurrent || isOwner ? (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          {!isCurrent ? (
            <Button
              className={whiteButtonClass}
              onClick={() => {
                setLedgerId(ledger.id);
                showToast({ tone: "success", message: `已切换到「${ledger.name}」` });
                pop();
              }}
              variant="secondary"
            >
              切换到此账本
            </Button>
          ) : null}

          {isOwner ? (
            <Button
              className={whiteButtonClass}
              disabled={createInvite.isPending}
              onClick={() => createInvite.mutate()}
              variant="secondary"
            >
              {createInvite.isPending ? "生成中…" : "生成邀请码"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {isOwner ? (
        <div className="flex flex-col gap-2">
          {confirmingDelete ? (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">
                删除后账本及其数据将无法访问，确定删除「{ledger.name}」吗？
              </p>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={deleteLedger.isPending}
                  onClick={() => deleteLedger.mutate()}
                  variant="danger"
                >
                  {deleteLedger.isPending ? "删除中…" : "确认删除"}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => setConfirmingDelete(false)}
                  variant="ghost"
                >
                  取消
                </Button>
              </div>
            </>
          ) : (
            <Button
              className={`${whiteButtonClass} !text-[var(--color-accent-expense)]`}
              onClick={() => setConfirmingDelete(true)}
              variant="danger"
            >
              删除账本
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
