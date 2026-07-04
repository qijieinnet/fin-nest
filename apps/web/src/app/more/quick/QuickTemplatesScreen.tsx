"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CategoryIcon,
  EmptyState,
  LoadingState,
  MoneyText,
  SwipeActionRow,
} from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type Category,
  type QuickTemplate,
} from "@/lib/api";
import {
  useAccounts,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useQuickTemplates,
} from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { DeleteQuickTemplateConfirmDialog } from "./_components/DeleteQuickTemplateConfirmDialog";
import { QuickTemplateEditorSheet } from "./_components/QuickTemplateEditorSheet";

function categoryDisplay(
  categories: Category[],
  categoryId: string | null,
  subcategoryId: string | null,
) {
  const category = categories.find((item) => item.id === categoryId);
  const sub = category?.subcategories.find((item) => item.id === subcategoryId);
  return {
    icon: sub?.icon ?? category?.icon ?? undefined,
    name: sub?.name ?? category?.name ?? "未分类",
  };
}

function transferAccountDisplay(
  accounts: Account[],
  fromAccountId: string | null,
  fromSubAccountId: string | null,
  toAccountId: string | null,
  toSubAccountId: string | null,
) {
  const from = accountDisplay(accounts, fromAccountId, fromSubAccountId) ?? "未选择转出";
  const to = accountDisplay(accounts, toAccountId, toSubAccountId) ?? "未选择转入";
  return `${from} → ${to}`;
}

function accountDisplay(
  accounts: Account[],
  accountId: string | null,
  subAccountId: string | null,
) {
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const sub = account.subAccounts.find((item) => item.id === subAccountId);
  return sub ? `${account.name} · ${sub.name}` : account.name;
}

export function QuickTemplatesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const templatesQuery = useQuickTemplates(ledgerId);
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);
  const [templatePendingDelete, setTemplatePendingDelete] = useState<QuickTemplate | null>(null);

  const templates = templatesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const insurances = insurancesQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const loading = templatesQuery.isPending || categoriesQuery.isPending || accountsQuery.isPending;

  const deleteTemplate = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/quick-templates/${templateId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      if (ledgerId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.quickTemplates(ledgerId) });
      }
      setTemplatePendingDelete(null);
      showToast({ tone: "success", message: "快速记账已删除" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (template?: QuickTemplate) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--quick-template",
      hideDefaultHeader: true,
      content: (
        <QuickTemplateEditorSheet
          accounts={accounts}
          categories={categories}
          insurances={insurances}
          items={items}
          ledgerId={ledgerId}
          people={people}
          template={template}
        />
      ),
    });
  };

  const renderRow = (template: QuickTemplate) => {
    const isTransfer = template.type === "transfer";
    const display = isTransfer
      ? { icon: "↔", name: "转账" }
      : categoryDisplay(categories, template.categoryId, template.subcategoryId);
    const account = accountDisplay(accounts, template.accountId, template.subAccountId);
    const transferAccount = transferAccountDisplay(
      accounts,
      template.fromAccountId,
      template.fromSubAccountId,
      template.toAccountId,
      template.toSubAccountId,
    );
    const name =
      template.name ??
      (template.type === "income"
        ? "收入模板"
        : template.type === "transfer"
          ? "转账模板"
          : "支出模板");
    const typeLabel =
      template.type === "income" ? "收入" : template.type === "transfer" ? "转账" : "支出";
    const meta = isTransfer
      ? [typeLabel, transferAccount].filter(Boolean).join(" · ")
      : [typeLabel, display.name, account].filter(Boolean).join(" · ");
    const actions: SwipeAction[] = [
      {
        icon: <Edit3 size={18} />,
        label: `编辑${name}`,
        onClick: () => openEditor(template),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${name}`,
        onClick: () => setTemplatePendingDelete(template),
        tone: "danger",
      },
    ];

    return (
      <SwipeActionRow actions={actions} key={template.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => openEditor(template)}
          type="button"
        >
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)]">
            <CategoryIcon icon={display.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
              {name}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
              {meta}
            </span>
          </span>
          {template.amountMicros ? (
            <MoneyText
              amountMicros={template.amountMicros}
              className="shrink-0 text-[15px] font-semibold"
              tone={
                template.type === "income"
                  ? "income"
                  : template.type === "transfer"
                    ? "transfer"
                    : "expense"
              }
            />
          ) : (
            <span className="shrink-0 text-xs text-[var(--color-text-muted)]">点按预填</span>
          )}
        </button>
      </SwipeActionRow>
    );
  };

  return (
    <MobileAppShell>
      <DeleteQuickTemplateConfirmDialog
        deleting={deleteTemplate.isPending}
        onCancel={() => {
          if (!deleteTemplate.isPending) setTemplatePendingDelete(null);
        }}
        onConfirm={() => {
          if (templatePendingDelete && !deleteTemplate.isPending) {
            deleteTemplate.mutate(templatePendingDelete.id);
          }
        }}
        template={templatePendingDelete}
      />
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新建快速记账"
            onClick={() => openEditor()}
          />
        }
        description="预设常用的一笔，在账单页点闪电即可一键记账。未填金额的会在记账时补填。"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="快速记账"
      >
        <div className="flex flex-col gap-3 pb-6">
          {loading ? (
            <LoadingState rows={4} title="加载快速记账" />
          ) : templates.length === 0 ? (
            <EmptyState
              message="把常买的一笔存成模板，在账单页一键就能记账。"
              title="还没有快速记账"
            />
          ) : (
            <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              <div className="divide-y divide-black/[0.06]">{templates.map(renderRow)}</div>
            </section>
          )}

          <button
            className="mt-1 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={() => openEditor()}
            type="button"
          >
            <Plus size={17} />
            新建快速记账
          </button>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
