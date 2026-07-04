"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  EmptyState,
  LoadingState,
  SwipeActionRow,
  TransactionGroup,
  TransactionRow,
} from "@/components/business";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AutoPendingTransaction,
  type Category,
} from "@/lib/api";
import { useAccounts, useAutoPending, useCategories } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useToast } from "@/providers";
import { DeletePendingConfirmDialog } from "./DeletePendingConfirmDialog";
import {
  accountSummary,
  categorySummary,
  transferAccountSummary,
} from "@/app/more/auto/_components/auto-utils";
import { dayLabel } from "../_components/bill-utils";

type PendingDayGroup = {
  date: string;
  expenseMicros: bigint;
  incomeMicros: bigint;
  items: AutoPendingTransaction[];
};

/** 按计划入账日分组（时间近的在前，同账单列表方向一致）。 */
function groupPendingByDay(items: AutoPendingTransaction[]): PendingDayGroup[] {
  const map = new Map<string, PendingDayGroup>();
  for (const item of items) {
    const date = item.scheduledFor.slice(0, 10);
    let group = map.get(date);
    if (!group) {
      group = { date, expenseMicros: 0n, incomeMicros: 0n, items: [] };
      map.set(date, group);
    }
    group.items.push(item);
    const amount = BigInt(item.amountMicros);
    if (item.type === "expense") group.expenseMicros += amount;
    if (item.type === "income") group.incomeMicros += amount;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function pendingRowProps(item: AutoPendingTransaction, accounts: Account[], categories: Category[]) {
  if (item.type === "transfer") {
    const summary = transferAccountSummary(
      accounts,
      item.fromAccountId,
      item.fromSubAccountId,
      item.toAccountId,
      item.toSubAccountId,
    );
    return {
      type: "transfer" as const,
      title: "转账",
      categoryName: "转账",
      categoryIcon: "transfer",
      description: summary.fullName,
      amountMicros: item.amountMicros,
    };
  }
  const summary = categorySummary(categories, item.categoryId, item.subcategoryId);
  const account = accountSummary(accounts, item.accountId, item.subAccountId);
  return {
    type: item.type,
    title: summary.name,
    categoryName: summary.name,
    categoryIcon: summary.icon,
    amountMicros: item.amountMicros,
    accountName: account.name,
    description: item.note ?? undefined,
  };
}

export function PendingBillsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();

  const [pendingDelete, setPendingDelete] = useState<AutoPendingTransaction | null>(null);

  const pendingQuery = useAutoPending(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const categoriesQuery = useCategories(ledgerId);

  const pending = useMemo(() => pendingQuery.data ?? [], [pendingQuery.data]);
  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const groups = useMemo(() => groupPendingByDay(pending), [pending]);
  const loading = pendingQuery.isPending || accountsQuery.isPending || categoriesQuery.isPending;

  const invalidatePending = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.autoPending(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
    ]);
  };

  const invalidateAfterConfirm = async () => {
    if (!ledgerId) return;
    await Promise.all([
      invalidatePending(),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
    ]);
  };

  const confirmPending = useMutation({
    mutationFn: (pendingId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/auto-pending-transactions/${pendingId}/confirm`), {
        method: "POST",
      }),
    onSuccess: async () => {
      await invalidateAfterConfirm();
      showToast({ tone: "success", message: "已确认入账" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "确认失败，请稍后重试") });
    },
  });

  const confirmBatch = useMutation({
    mutationFn: (pendingIds: string[]) =>
      apiRequest(ledgerApiPath(ledgerId!, "/auto-pending-transactions/confirm-batch"), {
        method: "POST",
        body: { pendingIds },
      }),
    onSuccess: async () => {
      await invalidateAfterConfirm();
      showToast({ tone: "success", message: "待确认记录已全部入账" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "批量确认失败，请稍后重试") });
    },
  });

  const deletePending = useMutation({
    mutationFn: (pendingId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/auto-pending-transactions/${pendingId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalidatePending();
      showToast({ tone: "success", message: "已删除这条待确认" });
      setPendingDelete(null);
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const busy = confirmPending.isPending || confirmBatch.isPending || deletePending.isPending;

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.bills);
    }
  };

  const openPendingEditor = (item: AutoPendingTransaction) => {
    router.push(routes.billPendingEdit(item.id));
  };

  return (
    <MobileAppShell>
      <MobilePage
        action={
          pending.length > 0 ? (
            <Button
              className="!h-9 !px-3 !text-sm"
              disabled={busy}
              onClick={() => confirmBatch.mutate(pending.map((item) => item.id))}
              variant="primary"
            >
              全部确认
            </Button>
          ) : (
            <span aria-hidden />
          )
        }
        description="定时记账生成的记录，确认后才会正式入账"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="待确认"
      >
        {loading ? (
          <LoadingState rows={4} title="加载待确认记录" />
        ) : groups.length === 0 ? (
          <div className="mt-10">
            <EmptyState message="定时记账到期后会在这里生成待确认记录。" title="暂无待确认" />
          </div>
        ) : (
          <div className="bill-list-shell flex flex-col gap-5 pb-6">
            {groups.map((group) => (
              <TransactionGroup
                dateLabel={dayLabel(group.date)}
                incomeMicros={group.incomeMicros > 0n ? group.incomeMicros : undefined}
                key={group.date}
                totalMicros={group.expenseMicros > 0n ? group.expenseMicros : undefined}
              >
                {group.items.map((item) => (
                  <SwipeActionRow
                    actions={[
                      {
                        icon: <Pencil size={20} />,
                        label: "编辑",
                        onClick: () => openPendingEditor(item),
                      },
                      {
                        icon: <Trash2 size={20} />,
                        label: "删除",
                        onClick: () => {
                          if (!busy) setPendingDelete(item);
                        },
                        tone: "danger",
                      },
                    ]}
                    key={item.id}
                    leadingActions={[
                      {
                        icon: <Check size={20} />,
                        label: "确认",
                        onClick: () => {
                          if (!busy) confirmPending.mutate(item.id);
                        },
                        tone: "primary",
                      },
                    ]}
                  >
                    <TransactionRow
                      onClick={() => router.push(routes.billPending(item.id))}
                      {...pendingRowProps(item, accounts, categories)}
                    />
                  </SwipeActionRow>
                ))}
              </TransactionGroup>
            ))}
          </div>
        )}
      </MobilePage>

      <DeletePendingConfirmDialog
        deleting={deletePending.isPending}
        onCancel={() => {
          if (!deletePending.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete && !deletePending.isPending) deletePending.mutate(pendingDelete.id);
        }}
        open={Boolean(pendingDelete)}
      />
    </MobileAppShell>
  );
}
