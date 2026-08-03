"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type AutoPendingTransaction,
} from "@/lib/api";
import { useAccounts, useAutoPending, useCategories } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useToast } from "@/providers";
import { DeletePendingConfirmDialog } from "./DeletePendingConfirmDialog";
import { PendingTransactionList } from "./PendingTransactionList";

export function PendingBillsScreen() {
  const router = useAppRouter();
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
        ) : pending.length === 0 ? (
          <div className="mt-10">
            <EmptyState message="定时记账到期后会在这里生成待确认记录。" title="暂无待确认" />
          </div>
        ) : (
          <div className="pb-6">
            <PendingTransactionList
              accounts={accounts}
              busy={busy}
              categories={categories}
              items={pending}
              onConfirm={(item) => confirmPending.mutate(item.id)}
              onDelete={setPendingDelete}
              onEdit={openPendingEditor}
              onOpen={(item) => router.push(routes.billPending(item.id))}
            />
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
