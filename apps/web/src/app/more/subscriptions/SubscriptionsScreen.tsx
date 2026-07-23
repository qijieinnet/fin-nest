"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveX,
  ArrowUpDown,
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Edit3,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import {
  Button,
  EdgeFade,
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  MobilePage,
  MobileTabBar,
  PopoverMenu,
} from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Subscription,
  type SubscriptionCategory,
} from "@/lib/api";
import { useSubscriptionCategories, useSubscriptions } from "@/lib/data/records";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { useIsPrimaryNavMenu } from "@/lib/nav/useNavMenuPlacement";
import { cn } from "@/lib/format/class-names";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, useSheetStack, useToast } from "@/providers";
import {
  AssetFilterSheet,
  countActiveAssetFilters,
  type AssetFilterOption,
  type AssetFilterValue,
} from "../_components/AssetFilterSheet";
import { DeleteSubscriptionConfirmDialog } from "./_components/DeleteSubscriptionConfirmDialog";
import { SubscriptionDetailSheet } from "./_components/SubscriptionDetailSheet";
import { SubscriptionEditorSheet } from "./_components/SubscriptionEditorSheet";
import {
  dueRenewalSubscriptions,
  SubscriptionRenewalConfirmSheet,
} from "./_components/SubscriptionRenewalConfirmSheet";
import {
  SubscriptionSortList,
  type SubscriptionSortGroup,
} from "./_components/SubscriptionSortList";
import {
  billingCycleLabel,
  categoryGlyph,
  formatDateLabel,
  formatMoney,
  monthlyCostMicros,
  renewalReminderDue,
  subscriptionStatus,
} from "./_components/subscription-utils";

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  dueSoon: "bg-[rgba(255,149,0,0.14)] text-[var(--color-accent-warning,#c77700)]",
  terminated: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

const SUBSCRIPTION_STATUS_OPTIONS: AssetFilterOption[] = [
  { id: "active", label: "使用中" },
  { id: "dueSoon", label: "即将到期" },
];

const TERMINATED_STATUS_OPTIONS: AssetFilterOption[] = [{ id: "terminated", label: "已退订" }];

type SubscriptionGroup = {
  key: string;
  category: SubscriptionCategory | null;
  items: Subscription[];
};

function parseFilterMoney(value: string | undefined, decimalPlaces: number): bigint | null {
  if (!value) return null;
  const parsed = parseMoneyToMicros(value, { decimalPlaces });
  return parsed.ok ? BigInt(parsed.amountMicros) : null;
}

function compareSubscriptions(a: Subscription, b: Subscription): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

function matchesStartDateRange(
  subscription: Pick<Subscription, "startDate">,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): boolean {
  if (!dateFrom && !dateTo) return true;
  if (!subscription.startDate) return false;
  const startDate = subscription.startDate.slice(0, 10);
  if (dateFrom && startDate < dateFrom) return false;
  if (dateTo && startDate > dateTo) return false;
  return true;
}

function subscriptionCategoryId(
  subscription: Subscription,
  categoryById: Map<string, SubscriptionCategory>,
): string {
  return subscription.categoryId && categoryById.has(subscription.categoryId)
    ? subscription.categoryId
    : "uncategorized";
}

function buildFilterOptions(
  subscriptions: Subscription[],
  categories: SubscriptionCategory[],
  categoryById: Map<string, SubscriptionCategory>,
): AssetFilterOption[] {
  const hasUncategorized = subscriptions.some(
    (subscription) => subscriptionCategoryId(subscription, categoryById) === "uncategorized",
  );
  return [
    ...categories
      .filter((category) => subscriptions.some((sub) => sub.categoryId === category.id))
      .map((category) => ({
        icon: categoryGlyph(category),
        id: category.id,
        label: category.name,
      })),
    ...(hasUncategorized
      ? [{ icon: categoryGlyph(null), id: "uncategorized", label: "未分类" }]
      : []),
  ];
}

function filterSubscriptions(
  subscriptions: Subscription[],
  categoryById: Map<string, SubscriptionCategory>,
  filterValue: AssetFilterValue,
  decimalPlaces: number,
): Subscription[] {
  const amountMinMicros = parseFilterMoney(filterValue.amountMin, decimalPlaces);
  const amountMaxMicros = parseFilterMoney(filterValue.amountMax, decimalPlaces);
  const keyword = filterValue.keyword?.trim().toLowerCase();

  return subscriptions.filter((subscription) => {
    const categoryId = subscriptionCategoryId(subscription, categoryById);
    if (filterValue.categoryIds?.length && !filterValue.categoryIds.includes(categoryId)) {
      return false;
    }

    const status = subscriptionStatus(subscription);
    if (filterValue.statusIds?.length && !filterValue.statusIds.includes(status.key)) {
      return false;
    }

    const price = BigInt(subscription.priceMicros ?? "0");
    if (amountMinMicros !== null && price < amountMinMicros) return false;
    if (amountMaxMicros !== null && price > amountMaxMicros) return false;

    if (!matchesStartDateRange(subscription, filterValue.dateFrom, filterValue.dateTo)) {
      return false;
    }

    if (keyword) {
      const categoryName = categoryById.get(subscription.categoryId ?? "")?.name ?? "未分类";
      const searchable = [
        subscription.name,
        subscription.provider,
        subscription.planName,
        subscription.paymentMethod,
        subscription.note,
        categoryName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }

    return true;
  });
}

function buildGroups(
  subscriptions: Subscription[],
  categories: SubscriptionCategory[],
  categoryById: Map<string, SubscriptionCategory>,
  options: { includeArchivedCategories?: boolean; includeEmptyCategories?: boolean } = {},
): SubscriptionGroup[] {
  const categoryGroups = categories
    .filter((category) => options.includeArchivedCategories || !category.archivedAt)
    .map((category) => ({
      key: category.id,
      category,
      items: subscriptions
        .filter((subscription) => subscription.categoryId === category.id)
        .sort(compareSubscriptions),
    }))
    .filter(
      (group) =>
        (options.includeEmptyCategories && !group.category.archivedAt) || group.items.length > 0,
    );
  const missing = subscriptions
    .filter(
      (subscription) => !subscription.categoryId || !categoryById.has(subscription.categoryId),
    )
    .sort(compareSubscriptions);
  return [
    ...categoryGroups,
    ...(missing.length > 0 ? [{ key: "uncategorized", category: null, items: missing }] : []),
  ];
}

type TerminatedSubscriptionsSheetProps = {
  categories: SubscriptionCategory[];
  decimalPlaces: number;
  renderRow: (subscription: Subscription) => ReactNode;
  subscriptions: Subscription[];
};

function TerminatedSubscriptionsSheet({
  categories,
  decimalPlaces,
  renderRow,
  subscriptions,
}: TerminatedSubscriptionsSheetProps) {
  const { pop } = useSheetStack();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const filterOptions = buildFilterOptions(subscriptions, categories, categoryById);
  const filtered = filterSubscriptions(subscriptions, categoryById, filterValue, decimalPlaces);
  const groups = buildGroups(filtered, categories, categoryById, {
    includeArchivedCategories: true,
  });

  const toggleGroup = (groupKey: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <AssetFilterSheet
        amountLabel="费用区间"
        categoryLabel="订阅分类"
        categoryOptions={filterOptions}
        dateLabel="开通日期"
        keywordPlaceholder="搜索名称、服务商、备注..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="订阅状态"
        statusOptions={TERMINATED_STATUS_OPTIONS}
        value={filterValue}
      />

      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <div className="min-w-0 text-center">
          <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            已退订
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {filtered.length} / {subscriptions.length} 个
          </p>
        </div>
        <div className="relative">
          <IconButton
            icon={<SlidersHorizontal size={22} strokeWidth={2.2} />}
            label="筛选已退订订阅"
            onClick={() => setFilterOpen(true)}
          />
          {activeFilterCount > 0 ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-accent-expense)]"
            />
          ) : null}
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <EmptyState message="退订后的订阅会集中放在这里。" title="还没有已退订订阅" />
      ) : filtered.length === 0 ? (
        <EmptyState message="调整筛选条件后再试。" title="没有符合条件的订阅" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => {
            const categoryName = group.category?.name ?? "未分类";
            const expanded = !collapsedIds.has(group.key);
            return (
              <section
                className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                key={group.key}
              >
                <button
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                    {categoryGlyph(group.category)}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {categoryName}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {group.items.length} 个
                  </span>
                  <ChevronDown
                    className={cn(
                      "text-[var(--color-text-muted)] transition-transform",
                      expanded && "rotate-180",
                    )}
                    size={18}
                  />
                </button>
                {expanded ? (
                  <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                    {group.items.map(renderRow)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SubscriptionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const isDesktop = useIsDesktop();
  // 用户把「订阅」放到导航栏时作为一级页（内嵌底部导航、无返回）；在「更多」里则全屏 + 返回。
  const isPrimary = useIsPrimaryNavMenu("subscriptions");
  const subscriptionsQuery = useSubscriptions(ledgerId);
  const categoriesQuery = useSubscriptionCategories(ledgerId);
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const subscriptions = subscriptionsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const activeSubscriptions = subscriptions.filter((subscription) => !subscription.terminatedAt);
  const terminatedSubscriptions = subscriptions.filter((subscription) => subscription.terminatedAt);
  const dueRenewalCount = dueRenewalSubscriptions(subscriptions).length;
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const filterOptions = buildFilterOptions(activeSubscriptions, categories, categoryById);
  const filtered = filterSubscriptions(
    activeSubscriptions,
    categoryById,
    filterValue,
    decimalPlaces,
  );
  const monthlyTotal = filtered
    .reduce((sum, subscription) => sum + monthlyCostMicros(subscription), 0n)
    .toString();
  const spendTotal = filtered
    .reduce((sum, subscription) => sum + BigInt(subscription.totalSpendMicros ?? "0"), 0n)
    .toString();
  const groups = buildGroups(filtered, categories, categoryById, {
    includeArchivedCategories: true,
  });
  const rawSortGroups: SubscriptionSortGroup[] = buildGroups(
    activeSubscriptions,
    categories,
    categoryById,
    { includeEmptyCategories: true, includeArchivedCategories: true },
  );
  const sortGroups = [
    ...rawSortGroups.filter((group) => group.category && !group.category.archivedAt),
    ...rawSortGroups.filter((group) => !group.category || group.category.archivedAt),
  ];
  const allGroupsCollapsed =
    groups.length > 0 && groups.every((group) => collapsedIds.has(group.key));
  const subscriptionsKey = queryKeys.subscriptions(ledgerId ?? "none");
  const categoriesKey = queryKeys.subscriptionCategories(ledgerId ?? "none");

  const invalidate = async (subscriptionId?: string) => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions(ledgerId) }),
      subscriptionId
        ? queryClient.invalidateQueries({
            queryKey: queryKeys.subscription(ledgerId, subscriptionId),
          })
        : Promise.resolve(),
    ]);
  };

  const terminate = useMutation({
    mutationFn: (subscriptionId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/subscriptions/${subscriptionId}/terminate`), {
        method: "POST",
      }),
    onSuccess: async (_data, subscriptionId) => {
      await invalidate(subscriptionId);
      showToast({ tone: "success", message: "已退订" });
    },
  });

  const resume = useMutation({
    mutationFn: (subscriptionId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/subscriptions/${subscriptionId}/resume`), {
        method: "POST",
      }),
    onSuccess: async (_data, subscriptionId) => {
      await invalidate(subscriptionId);
      showToast({ tone: "success", message: "已恢复订阅" });
    },
  });

  const remove = useMutation({
    mutationFn: (subscriptionId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/subscriptions/${subscriptionId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
      clear();
      showToast({ tone: "success", message: "订阅已删除" });
    },
  });

  const reorderCategories = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/subscription-categories/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });

  const reorderSubscriptions = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/subscriptions/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionsKey });
    },
  });

  const toggleGroup = (groupKey: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const toggleAllGroups = () => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (allGroupsCollapsed) {
        groups.forEach((group) => next.delete(group.key));
      } else {
        groups.forEach((group) => next.add(group.key));
      }
      return next;
    });
  };

  const enterSortMode = () => {
    setMoreMenuOpen(false);
    setSortMode(true);
  };

  const handleReorderCategories = (orderedIds: string[]) => {
    queryClient.setQueryData<SubscriptionCategory[]>(categoriesKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((category) =>
          position.has(category.id)
            ? { ...category, sortOrder: position.get(category.id)! }
            : category,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    });
    reorderCategories.mutate(orderedIds);
  };

  const handleReorderSubscriptions = (_groupKey: string, orderedIds: string[]) => {
    queryClient.setQueryData<Subscription[]>(subscriptionsKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((subscription) =>
          position.has(subscription.id)
            ? { ...subscription, sortOrder: position.get(subscription.id)! }
            : subscription,
        )
        .sort((a, b) => {
          const aGroup = subscriptionCategoryId(a, categoryById);
          const bGroup = subscriptionCategoryId(b, categoryById);
          return aGroup.localeCompare(bGroup) || compareSubscriptions(a, b);
        });
    });
    reorderSubscriptions.mutate(orderedIds);
  };

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (subscription?: Subscription) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <SubscriptionEditorSheet ledgerId={ledgerId} subscription={latest(subscription)} />,
    });
  };

  /**
   * 取缓存里最新的那份订阅。
   *
   * 详情弹层是以 JSX 元素的形式压进 sheet 栈的，它的 `onEdit` 闭包捕获的是**压栈那一刻**的
   * 列表项；保存后列表刷新了，但那个闭包不会重建，直接用就会把编辑器回填成保存前的旧值
   * （多档提醒尤其明显：少了刚加的那几档）。所以点击时按 id 重新取一次。
   */
  function latest(subscription?: Subscription): Subscription | undefined {
    if (!subscription || !ledgerId) return subscription;
    const cached = queryClient.getQueryData<Subscription[]>(queryKeys.subscriptions(ledgerId));
    return cached?.find((item) => item.id === subscription.id) ?? subscription;
  }

  const openRenewals = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: <SubscriptionRenewalConfirmSheet ledgerId={ledgerId} />,
    });
  };

  const openTerminated = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: (
        <TerminatedSubscriptionsSheet
          categories={categories}
          decimalPlaces={decimalPlaces}
          renderRow={renderRow}
          subscriptions={terminatedSubscriptions}
        />
      ),
    });
  };

  const openDetail = (subscription: Subscription) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      title: "订阅详情",
      content: (
        <SubscriptionDetailSheet
          categories={categories}
          ledgerId={ledgerId}
          onDelete={() => setPendingDelete(subscription)}
          onEdit={() => openEditor(subscription)}
          onResume={() => resume.mutate(subscription.id)}
          onTerminate={() => terminate.mutate(subscription.id)}
          resuming={resume.isPending}
          subscriptionId={subscription.id}
          terminating={terminate.isPending}
        />
      ),
    });
  };

  const renderRow = (subscription: Subscription) => {
    const category = categories.find((entry) => entry.id === subscription.categoryId);
    const categoryName = category?.name ?? "未分类";
    const status = subscriptionStatus(subscription);
    const nextRenewalText = subscription.nextRenewalDate
      ? `${formatDateLabel(subscription.nextRenewalDate)}`
      : null;
    const metaText = [
      categoryName,
      billingCycleLabel(subscription.billingCycle),
      nextRenewalText,
      subscription.provider,
    ]
      .filter(Boolean)
      .join(" · ");
    const monthly = monthlyCostMicros(subscription);
    const actions: SwipeAction[] = [
      {
        icon: <Edit3 size={18} />,
        label: `编辑${subscription.name}`,
        onClick: () => openEditor(subscription),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${subscription.name}`,
        onClick: () => setPendingDelete(subscription),
        tone: "danger",
      },
    ];

    return (
      <SwipeActionRow actions={actions} desktopClickable key={subscription.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => openDetail(subscription)}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                {subscription.name}
              </span>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status.tone]}`}
              >
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
              {metaText}
            </span>
          </span>
          {subscription.priceMicros ? (
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                {formatMoney(subscription.priceMicros)}
              </span>
              {monthly > 0n ? (
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  月均 {formatMoney(monthly)}
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
      </SwipeActionRow>
    );
  };

  return (
    <MobileAppShell>
      <AssetFilterSheet
        amountLabel="费用区间"
        categoryLabel="订阅分类"
        categoryOptions={filterOptions}
        dateLabel="开通日期"
        keywordPlaceholder="搜索名称、服务商、备注..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="订阅状态"
        statusOptions={SUBSCRIPTION_STATUS_OPTIONS}
        value={filterValue}
      />
      <DeleteSubscriptionConfirmDialog
        deleting={remove.isPending}
        onCancel={() => {
          if (!remove.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete && !remove.isPending) remove.mutate(pendingDelete.id);
        }}
        subscription={pendingDelete}
      />
      <MobilePage
        action={
          sortMode ? (
            <Button onClick={() => setSortMode(false)} variant="primary">
              完成
            </Button>
          ) : (
            <div className="relative flex justify-end">
              <IconButtonGroup
                items={[
                  {
                    dot: activeFilterCount > 0,
                    icon: <SlidersHorizontal size={20} strokeWidth={2.2} />,
                    label: "筛选订阅",
                    onClick: () => setFilterOpen(true),
                  },
                  {
                    dot: dueRenewalCount > 0,
                    icon: <MoreHorizontal size={22} strokeWidth={2.3} />,
                    label: "更多选项",
                    onClick: () => setMoreMenuOpen((open) => !open),
                  },
                ]}
              />
              <PopoverMenu
                groups={[
                  // 桌面端把「添加订阅」收进更多菜单；移动端保留右下角悬浮按钮。
                  ...(isDesktop
                    ? [
                        [
                          {
                            icon: <Plus size={18} />,
                            label: "添加订阅",
                            onSelect: () => {
                              setMoreMenuOpen(false);
                              openEditor();
                            },
                          },
                        ],
                      ]
                    : []),
                  ...(dueRenewalCount > 0
                    ? [
                        [
                          {
                            description: `${dueRenewalCount} 个待确认`,
                            icon: <BellRing size={18} />,
                            label: "续费确认",
                            onSelect: openRenewals,
                          },
                        ],
                      ]
                    : []),
                  [
                    {
                      icon: allGroupsCollapsed ? (
                        <ChevronsUpDown size={18} />
                      ) : (
                        <ChevronsDownUp size={18} />
                      ),
                      label: allGroupsCollapsed ? "展开所有" : "折叠所有",
                      onSelect: toggleAllGroups,
                    },
                    {
                      icon: <ArrowUpDown size={18} />,
                      label: "排序",
                      onSelect: enterSortMode,
                    },
                    {
                      description: `${terminatedSubscriptions.length} 个`,
                      icon: <ArchiveX size={18} />,
                      label: "已退订",
                      onSelect: openTerminated,
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          )
        }
        description="集中管理 iCloud、Claude、Apple Music 等套餐订阅，记录费用与续费日，记账时关联订阅即可归集花费。左滑可编辑或删除。"
        leading={
          isDesktop || !isPrimary || sortMode ? (
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label={sortMode ? "退出排序" : "返回"}
              onClick={goBack}
            />
          ) : undefined
        }
        navigationTitleAlign="left"
        title={sortMode ? "拖动排序" : "订阅管理"}
      >
        <div className="flex flex-col gap-3 pb-22">
          {subscriptionsQuery.isPending || categoriesQuery.isPending ? (
            <LoadingState rows={4} title="加载订阅" />
          ) : subscriptions.length === 0 ? (
            <EmptyState
              message="把 iCloud、Claude、Apple Music 等订阅录入，月均花费与续费日一目了然。"
              title="还没有添加订阅"
            />
          ) : sortMode ? (
            <>
              <p className="px-1 text-xs text-[var(--color-text-muted)]">
                按住右侧图标拖动排序；订阅分类整体移动，订阅仅在所属分类内排序。
              </p>
              <SubscriptionSortList
                collapsedIds={collapsedIds}
                groups={sortGroups}
                onReorderCategories={handleReorderCategories}
                onReorderSubscriptions={handleReorderSubscriptions}
              />
            </>
          ) : (
            <>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  月均订阅支出
                </div>
                <p className="mt-1.5 flex items-baseline gap-0.5">
                  <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">
                    ¥
                  </span>
                  <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                    {formatMoney(monthlyTotal)}
                  </span>
                </p>
                <div className="mt-3.5 flex gap-7">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      使用中
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {filtered.length} 个
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      累计花费
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {formatMoney(spendTotal)}
                    </div>
                  </div>
                </div>
              </section>

              {filtered.length === 0 ? (
                <EmptyState message="调整筛选条件后再试。" title="没有符合条件的订阅" />
              ) : (
                groups.map((group) => {
                  const categoryName = group.category?.name ?? "未分类";
                  const expanded = !collapsedIds.has(group.key);

                  return (
                    <section
                      className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                      key={group.key}
                    >
                      <button
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-2 px-4 py-3 text-left"
                        onClick={() => toggleGroup(group.key)}
                        type="button"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                          {categoryGlyph(group.category)}
                        </span>
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                          {categoryName}
                        </span>
                        <span className="text-xs font-medium text-[var(--color-text-muted)]">
                          {group.items.length} 个
                        </span>
                        <ChevronDown
                          className={cn(
                            "text-[var(--color-text-muted)] transition-transform",
                            expanded && "rotate-180",
                          )}
                          size={18}
                        />
                      </button>
                      {expanded ? (
                        <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                          {group.items.map(renderRow)}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              )}
            </>
          )}
        </div>
      </MobilePage>
      <EdgeFade />

      {!isDesktop && !sortMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
          <div className="relative w-[min(100vw,430px)]">
            <div className="pointer-events-auto absolute bottom-[calc(var(--space-tab-bar-height)+34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] bg-[var(--color-tint)] shadow-[var(--shadow-app)]">
              <button
                aria-label="添加订阅"
                className="flex h-full w-full items-center justify-center text-[var(--color-tint-contrast)]"
                onClick={() => openEditor()}
                type="button"
              >
                <Plus size={22} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isPrimary && !sortMode ? <MobileTabBar /> : null}
    </MobileAppShell>
  );
}
