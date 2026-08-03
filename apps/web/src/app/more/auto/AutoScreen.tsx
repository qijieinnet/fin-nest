"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, Trash2 } from "lucide-react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { IconButton, Button, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type AutoPendingTransaction,
  type AutoRule,
} from "@/lib/api";
import {
  useAccounts,
  useAutoPending,
  useAutoRules,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useSubscriptions,
} from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";
import { PendingTransactionList } from "@/app/bills/pending/PendingTransactionList";
import { AutoPendingEditorSheet } from "./_components/AutoPendingEditorSheet";
import { AutoRuleDetailSheet } from "./_components/AutoRuleDetailSheet";
import { AutoRuleEditorSheet } from "./_components/AutoRuleEditorSheet";
import {
  accountSummary,
  amountToneClass,
  categorySummary,
  formatDateLabel,
  REPEAT_LABELS,
  signedAmountText,
  transactionTypeLabel,
  transferAccountSummary,
} from "./_components/auto-utils";

function sectionTitle(count: number): string {
  return count > 0 ? `进行中 · ${count} 条规则` : "进行中";
}

export function AutoScreen() {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push, pop, stack } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();

  const rulesQuery = useAutoRules(ledgerId);
  const pendingQuery = useAutoPending(ledgerId);
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);
  const subscriptionsQuery = useSubscriptions(ledgerId);

  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const insurances = insurancesQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const pending = pendingQuery.data ?? [];
  const activeRuleCount = rules.filter((rule) => rule.enabled).length;
  const loadingBase = categoriesQuery.isPending || accountsQuery.isPending || peopleQuery.isPending;

  const invalidateAutomation = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.autoRules(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.autoPending(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
    ]);
  };

  const invalidateAfterConfirm = async () => {
    if (!ledgerId) return;
    await Promise.all([
      invalidateAutomation(),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
    ]);
  };

  const toggleRule = useMutation({
    mutationFn: (rule: AutoRule) =>
      apiRequest<AutoRule>(ledgerApiPath(ledgerId!, `/auto-rules/${rule.id}`), {
        method: "PATCH",
        body: { enabled: !rule.enabled },
      }),
    onSuccess: async () => {
      await invalidateAutomation();
    },
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/auto-rules/${ruleId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidateAutomation();
      if (stack.length > 0) pop();
      showToast({ tone: "success", message: "自动记账已删除" });
    },
  });

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
      await invalidateAutomation();
      showToast({ tone: "success", message: "已忽略这条待确认" });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const openEditor = (rule?: AutoRule) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: (
        <AutoRuleEditorSheet
          accounts={accounts}
          categories={categories}
          insurances={insurances}
          items={items}
          ledgerId={ledgerId}
          people={people}
          rule={rule}
          subscriptions={subscriptions}
        />
      ),
    });
  };

  const openPendingEditor = (item: AutoPendingTransaction) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: (
        <AutoPendingEditorSheet
          accounts={accounts}
          categories={categories}
          ledgerId={ledgerId}
          pending={item}
          people={people}
        />
      ),
    });
  };

  const requestDeleteRule = async (rule: AutoRule) => {
    if (deleteRule.isPending) return;
    const summary =
      rule.type === "transfer"
        ? transferAccountSummary(
            accounts,
            rule.fromAccountId,
            rule.fromSubAccountId,
            rule.toAccountId,
            rule.toSubAccountId,
          )
        : categorySummary(categories, rule.categoryId, rule.subcategoryId);
    await confirm({
      title: "删除自动记账？",
      message: `将停止并归档「${summary.name}」这条规则，已生成的待确认记录和历史账单不会自动删除。`,
      confirmText: "删除",
      onConfirm: () => deleteRule.mutateAsync(rule.id),
      tone: "danger",
    });
  };

  const openDetail = (rule: AutoRule) => {
    push({
      className: "ui-bottom-sheet--edge-scroll",
      title: "自动记账详情",
      content: (
        <AutoRuleDetailSheet
          accounts={accounts}
          categories={categories}
          insurances={insurances}
          items={items}
          onDelete={() => void requestDeleteRule(rule)}
          onEdit={() => openEditor(rule)}
          onToggle={() => toggleRule.mutate(rule)}
          pendingToggle={toggleRule.isPending}
          people={people}
          subscriptions={subscriptions}
          rule={rule}
        />
      ),
    });
  };

  const renderRuleRow = (rule: AutoRule) => {
    const summary =
      rule.type === "transfer"
        ? transferAccountSummary(
            accounts,
            rule.fromAccountId,
            rule.fromSubAccountId,
            rule.toAccountId,
            rule.toSubAccountId,
          )
        : categorySummary(categories, rule.categoryId, rule.subcategoryId);
    const account = accountSummary(accounts, rule.accountId, rule.subAccountId);
    const meta = rule.type === "transfer" ? summary.fullName : account.name;
    const actions: SwipeAction[] = [
      {
        icon: <Edit3 size={18} />,
        label: `编辑${summary.name}`,
        onClick: () => openEditor(rule),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${summary.name}`,
        onClick: () => void requestDeleteRule(rule),
        tone: "danger",
      },
    ];
    const nextLabel = rule.enabled ? formatDateLabel(rule.nextRunOn) : "已暂停";

    return (
      <SwipeActionRow actions={actions} key={rule.id}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => openDetail(rule)}
            type="button"
          >
            {/* <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] text-[21px] opacity-[var(--auto-rule-dim,1)]">
              {summary.icon}
            </span> */}
            <span className="min-w-0 flex-1 opacity-[var(--auto-rule-dim,1)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                  {rule.note ? <span className="truncate">{rule.note}</span> : summary.name}
                </span>

                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                    rule.enabled
                      ? "bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
                      : "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {REPEAT_LABELS[rule.repeatRule]}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                {transactionTypeLabel(rule.type)} · {summary.name} · {nextLabel} · {meta}
              </span>
            </span>
          </button>
          <span className={`shrink-0 text-[16px] font-semibold ${amountToneClass(rule.type)}`}>
            {signedAmountText(rule.type, rule.amountMicros)}
          </span>
          <Switch
            checked={rule.enabled}
            disabled={toggleRule.isPending}
            label={`启用${summary.name}`}
            onCheckedChange={() => toggleRule.mutate(rule)}
          />
        </div>
      </SwipeActionRow>
    );
  };

  const pendingBusy = confirmBatch.isPending || confirmPending.isPending || deletePending.isPending;

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新建自动记账"
            onClick={() => openEditor()}
          />
        }
        description="按设定周期生成待确认记录，确认后才会正式入账"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title="自动记账"
      >
        <div className="flex flex-col gap-3 pb-6">
          {loadingBase ? (
            <LoadingState rows={5} title="加载自动记账" />
          ) : (
            <>
              {pending.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1 py-1">
                    <span className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
                      待确认 · {pending.length} 条
                    </span>
                    <Button
                      className="!h-9 !px-3 !text-sm"
                      disabled={pendingBusy}
                      onClick={() => confirmBatch.mutate(pending.map((item) => item.id))}
                      variant="primary"
                    >
                      全部确认
                    </Button>
                  </div>
                  <PendingTransactionList
                    accounts={accounts}
                    busy={pendingBusy}
                    categories={categories}
                    items={pending}
                    onConfirm={(item) => confirmPending.mutate(item.id)}
                    onDelete={(item) => deletePending.mutate(item.id)}
                    onEdit={openPendingEditor}
                    onOpen={(item) => router.push(routes.billPending(item.id))}
                  />
                </section>
              ) : null}

              <div className="flex items-baseline justify-between px-1 py-1">
                <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
                  {sectionTitle(activeRuleCount)}
                </h2>
                {rules.length > 0 ? (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {rules.length - activeRuleCount > 0
                      ? `${rules.length - activeRuleCount} 条已暂停`
                      : "全部启用"}
                  </span>
                ) : null}
              </div>

              {rulesQuery.isPending ? (
                <LoadingState rows={4} title="加载自动记账规则" />
              ) : rules.length === 0 ? (
                <EmptyState
                  // action={
                  //   <Button onClick={() => openEditor()} variant="primary">
                  //     新建自动记账
                  //   </Button>
                  // }
                  message=""
                  title="还没有自动记账"
                />
              ) : (
                <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                  <div className="divide-y divide-black/[0.06]">{rules.map(renderRuleRow)}</div>
                </section>
              )}

              {pendingQuery.isPending && !pending.length ? (
                <p className="px-1 text-xs text-[var(--color-text-muted)]">正在检查待确认记录…</p>
              ) : null}

              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                自动记账只生成待确认记录，不会绕过账单确认。忽略某条待确认不会影响下一周期继续生成。
              </p>
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
