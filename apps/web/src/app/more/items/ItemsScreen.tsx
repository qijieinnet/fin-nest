"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveX,
  ArrowUpDown,
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
  type ItemAsset,
  type ItemType,
} from "@/lib/api";
import { useItems, useItemTypes } from "@/lib/data/records";
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
import { DeleteItemConfirmDialog } from "./_components/DeleteItemConfirmDialog";
import { ItemDetailSheet } from "./_components/ItemDetailSheet";
import { ItemEditorSheet } from "./_components/ItemEditorSheet";
import { ItemScrapSheet } from "./_components/ItemScrapSheet";
import { ItemSortList, type ItemSortGroup } from "./_components/ItemSortList";
import {
  formatAverage,
  formatDateLabel,
  formatFixed1,
  formatMoney,
  itemAverageMicros,
  itemStatus,
  itemTotalMicros,
  itemUsedMonths,
  itemUsedYears,
  typeGlyph,
} from "./_components/item-utils";

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  reached: "bg-[rgba(31,138,91,0.12)] text-[var(--color-accent-income)]",
  scrapped: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

const ITEM_STATUS_OPTIONS: AssetFilterOption[] = [
  { id: "active", label: "在用" },
  { id: "reached", label: "到达年限" },
];

const SCRAPPED_ITEM_STATUS_OPTIONS: AssetFilterOption[] = [{ id: "scrapped", label: "已报废" }];

type ItemGroup = {
  key: string;
  type: ItemType | null;
  items: ItemAsset[];
};

function parseFilterMoney(value: string | undefined, decimalPlaces: number): bigint | null {
  if (!value) return null;
  const parsed = parseMoneyToMicros(value, { decimalPlaces });
  return parsed.ok ? BigInt(parsed.amountMicros) : null;
}

function itemMatchesPurchaseDateRange(
  item: Pick<ItemAsset, "purchaseDate">,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): boolean {
  if (!dateFrom && !dateTo) return true;
  if (!item.purchaseDate) return false;
  const purchaseDate = item.purchaseDate.slice(0, 10);
  if (dateFrom && purchaseDate < dateFrom) return false;
  if (dateTo && purchaseDate > dateTo) return false;
  return true;
}

function compareItems(a: ItemAsset, b: ItemAsset): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

function itemCategoryId(item: ItemAsset, itemTypeById: Map<string, ItemType>): string {
  return item.typeId && itemTypeById.has(item.typeId) ? item.typeId : "uncategorized";
}

function buildItemFilterOptions(
  items: ItemAsset[],
  itemTypes: ItemType[],
  itemTypeById: Map<string, ItemType>,
): AssetFilterOption[] {
  const hasUncategorizedItems = items.some(
    (item) => itemCategoryId(item, itemTypeById) === "uncategorized",
  );
  return [
    ...itemTypes
      .filter((type) => items.some((item) => item.typeId === type.id))
      .map((type) => ({ icon: typeGlyph(type), id: type.id, label: type.name })),
    ...(hasUncategorizedItems
      ? [{ icon: typeGlyph(null), id: "uncategorized", label: "未分类" }]
      : []),
  ];
}

function filterItems(
  items: ItemAsset[],
  itemTypeById: Map<string, ItemType>,
  filterValue: AssetFilterValue,
  decimalPlaces: number,
): ItemAsset[] {
  const amountMinMicros = parseFilterMoney(filterValue.amountMin, decimalPlaces);
  const amountMaxMicros = parseFilterMoney(filterValue.amountMax, decimalPlaces);
  const keyword = filterValue.keyword?.trim().toLowerCase();

  return items.filter((item) => {
    const categoryId = itemCategoryId(item, itemTypeById);
    if (filterValue.categoryIds?.length && !filterValue.categoryIds.includes(categoryId)) {
      return false;
    }

    const status = itemStatus(item);
    if (filterValue.statusIds?.length && !filterValue.statusIds.includes(status.key)) {
      return false;
    }

    const total = itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0"));
    if (amountMinMicros !== null && total < amountMinMicros) return false;
    if (amountMaxMicros !== null && total > amountMaxMicros) return false;

    if (!itemMatchesPurchaseDateRange(item, filterValue.dateFrom, filterValue.dateTo)) {
      return false;
    }

    if (keyword) {
      const typeName = itemTypeById.get(item.typeId ?? "")?.name ?? "未分类";
      const searchable = [item.name, item.note, typeName].filter(Boolean).join(" ").toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }

    return true;
  });
}

function buildItemGroups(
  items: ItemAsset[],
  itemTypes: ItemType[],
  itemTypeById: Map<string, ItemType>,
  options: { includeEmptyTypes?: boolean; includeArchivedTypes?: boolean } = {},
): ItemGroup[] {
  const typeGroups = itemTypes
    .filter((type) => options.includeArchivedTypes || !type.archivedAt)
    .map((type) => ({
      key: type.id,
      type,
      items: items.filter((item) => item.typeId === type.id).sort(compareItems),
    }))
    .filter(
      (group) => (options.includeEmptyTypes && !group.type.archivedAt) || group.items.length > 0,
    );
  const missingTypeItems = items
    .filter((item) => !item.typeId || !itemTypeById.has(item.typeId))
    .sort(compareItems);
  return [
    ...typeGroups,
    ...(missingTypeItems.length > 0
      ? [{ key: "uncategorized", type: null, items: missingTypeItems }]
      : []),
  ];
}

type ScrappedItemsSheetProps = {
  decimalPlaces: number;
  itemTypes: ItemType[];
  items: ItemAsset[];
  renderRow: (item: ItemAsset) => ReactNode;
};

function ScrappedItemsSheet({
  decimalPlaces,
  itemTypes,
  items,
  renderRow,
}: ScrappedItemsSheetProps) {
  const { pop } = useSheetStack();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const itemTypeById = new Map(itemTypes.map((type) => [type.id, type]));
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const filterOptions = buildItemFilterOptions(items, itemTypes, itemTypeById);
  const filteredItems = filterItems(items, itemTypeById, filterValue, decimalPlaces);
  const groups = buildItemGroups(filteredItems, itemTypes, itemTypeById, {
    includeArchivedTypes: true,
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
        amountLabel="总价区间"
        categoryLabel="物品分类"
        categoryOptions={filterOptions}
        dateLabel="购买日期"
        keywordPlaceholder="搜索名称、备注..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="物品状态"
        statusOptions={SCRAPPED_ITEM_STATUS_OPTIONS}
        value={filterValue}
      />

      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <div className="min-w-0 text-center">
          <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            已报废物品
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {filteredItems.length} / {items.length} 件
          </p>
        </div>
        <div className="relative">
          <IconButton
            icon={<SlidersHorizontal size={22} strokeWidth={2.2} />}
            label="筛选已报废物品"
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

      {items.length === 0 ? (
        <EmptyState message="报废或出售后的物品会集中放在这里。" title="还没有已报废物品" />
      ) : filteredItems.length === 0 ? (
        <EmptyState message="调整筛选条件后再试。" title="没有符合条件的物品" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => {
            const typeName = group.type?.name ?? "未分类";
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
                    {typeGlyph(group.type)}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {typeName}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {group.items.length} 件
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

export function ItemsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const isDesktop = useIsDesktop();
  // 用户把「物品」放到导航栏时作为一级页（内嵌底部导航、无返回）；在「更多」里则全屏 + 返回。
  const isPrimary = useIsPrimaryNavMenu("items");
  const itemsQuery = useItems(ledgerId);
  const itemTypesQuery = useItemTypes(ledgerId);
  const [itemPendingDelete, setItemPendingDelete] = useState<ItemAsset | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const items = itemsQuery.data ?? [];
  const itemTypes = itemTypesQuery.data ?? [];
  const activeItems = items.filter((item) => !item.scrappedAt);
  const scrappedItems = items.filter((item) => item.scrappedAt);
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const itemTypeById = new Map(itemTypes.map((type) => [type.id, type]));
  const itemFilterOptions = buildItemFilterOptions(activeItems, itemTypes, itemTypeById);
  const filteredItems = filterItems(activeItems, itemTypeById, filterValue, decimalPlaces);
  const totalValue = filteredItems
    .reduce((sum, item) => sum + itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0")), 0n)
    .toString();
  const consumablesTotal = filteredItems
    .reduce((sum, item) => sum + BigInt(item.consumablesMicros ?? "0"), 0n)
    .toString();
  // 在用物品的平均年价/月价汇总：仅统计有购买日期的物品，按各自使用时长摊销后累加（微单位）。
  const avgYearMicros = BigInt(
    Math.round(
      filteredItems.reduce((sum, item) => {
        if (!item.purchaseDate) return sum;
        const total = itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0"));
        return sum + itemAverageMicros(total, itemUsedYears(item));
      }, 0),
    ),
  ).toString();
  const avgMonthMicros = BigInt(
    Math.round(
      filteredItems.reduce((sum, item) => {
        if (!item.purchaseDate) return sum;
        const total = itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0"));
        return sum + itemAverageMicros(total, itemUsedMonths(item));
      }, 0),
    ),
  ).toString();
  const itemGroups = buildItemGroups(filteredItems, itemTypes, itemTypeById, {
    includeArchivedTypes: true,
  });
  const rawSortGroups: ItemSortGroup[] = buildItemGroups(activeItems, itemTypes, itemTypeById, {
    includeEmptyTypes: true,
    includeArchivedTypes: true,
  });
  const sortGroups = [
    ...rawSortGroups.filter((group) => group.type && !group.type.archivedAt),
    ...rawSortGroups.filter((group) => !group.type || group.type.archivedAt),
  ];
  const allGroupsCollapsed =
    itemGroups.length > 0 && itemGroups.every((group) => collapsedIds.has(group.key));
  const itemsKey = queryKeys.items(ledgerId ?? "none");
  const itemTypesKey = queryKeys.itemTypes(ledgerId ?? "none");

  const invalidate = async (itemId?: string) => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.items(ledgerId) }),
      itemId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.item(ledgerId, itemId) })
        : Promise.resolve(),
    ]);
  };

  const restore = useMutation({
    mutationFn: (itemId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/items/${itemId}/restore`), { method: "POST" }),
    onSuccess: async (_data, itemId) => {
      await invalidate(itemId);
      showToast({ tone: "success", message: "已恢复在用" });
    },
  });

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/items/${itemId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      setItemPendingDelete(null);
      // 从详情弹层删除时把弹层一并关掉，避免停留在已删除的物品上。
      clear();
      showToast({ tone: "success", message: "物品已删除" });
    },
  });

  const reorderTypes = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/item-types/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: itemTypesKey });
    },
  });

  const reorderItems = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/items/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
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
        itemGroups.forEach((group) => next.delete(group.key));
      } else {
        itemGroups.forEach((group) => next.add(group.key));
      }
      return next;
    });
  };

  const enterSortMode = () => {
    setMoreMenuOpen(false);
    setSortMode(true);
  };

  const handleReorderTypes = (orderedIds: string[]) => {
    queryClient.setQueryData<ItemType[]>(itemTypesKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((type) =>
          position.has(type.id) ? { ...type, sortOrder: position.get(type.id)! } : type,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    });
    reorderTypes.mutate(orderedIds);
  };

  const handleReorderItems = (_groupKey: string, orderedIds: string[]) => {
    queryClient.setQueryData<ItemAsset[]>(itemsKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((item) =>
          position.has(item.id) ? { ...item, sortOrder: position.get(item.id)! } : item,
        )
        .sort((a, b) => {
          const aGroup = itemCategoryId(a, itemTypeById);
          const bGroup = itemCategoryId(b, itemTypeById);
          return aGroup.localeCompare(bGroup) || compareItems(a, b);
        });
    });
    reorderItems.mutate(orderedIds);
  };

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (item?: ItemAsset) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <ItemEditorSheet item={item} ledgerId={ledgerId} />,
    });
  };

  const openScrapSheet = (item: ItemAsset) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <ItemScrapSheet item={item} ledgerId={ledgerId} />,
    });
  };

  const openScrappedItems = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: (
        <ScrappedItemsSheet
          decimalPlaces={decimalPlaces}
          itemTypes={itemTypes}
          items={scrappedItems}
          renderRow={renderRow}
        />
      ),
    });
  };

  const openDetail = (item: ItemAsset) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      title: "物品详情",
      content: (
        <ItemDetailSheet
          itemId={item.id}
          itemTypes={itemTypes}
          ledgerId={ledgerId}
          onDelete={() => setItemPendingDelete(item)}
          onEdit={() => openEditor(item)}
          onRestore={() => restore.mutate(item.id)}
          onScrap={() => openScrapSheet(item)}
          restoring={restore.isPending}
        />
      ),
    });
  };

  const renderRow = (item: ItemAsset) => {
    const type = itemTypes.find((entry) => entry.id === item.typeId);
    const typeName = type?.name ?? "其他";
    const status = itemStatus(item);
    const total = itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0"));
    const metaText = [
      // typeName,
      item.purchaseDate ? formatDateLabel(item.purchaseDate) : null,
      item.purchaseDate ? `${formatFixed1(itemUsedYears(item))} 年` : "未填购买日",
    ]
      .filter(Boolean)
      .join(" · ");
    const usedText = item.purchaseDate
      ? `月均 ${formatAverage(total, itemUsedMonths(item))}`
      : null;
    const actions: SwipeAction[] = [
      {
        icon: <Edit3 size={18} />,
        label: `编辑${item.name}`,
        onClick: () => openEditor(item),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${item.name}`,
        onClick: () => setItemPendingDelete(item),
        tone: "danger",
      },
    ];

    return (
      <SwipeActionRow actions={actions} desktopClickable key={item.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => openDetail(item)}
          type="button"
        >
          {/* <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] text-[21px]">
            {typeGlyph(type)}
          </span> */}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                {item.name}
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
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {formatMoney(total)}
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)]">{usedText}</span>
          </span>
        </button>
      </SwipeActionRow>
    );
  };

  return (
    <MobileAppShell>
      <AssetFilterSheet
        amountLabel="总价区间"
        categoryLabel="物品分类"
        categoryOptions={itemFilterOptions}
        dateLabel="购买日期"
        keywordPlaceholder="搜索名称、备注..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="物品状态"
        statusOptions={ITEM_STATUS_OPTIONS}
        value={filterValue}
      />
      <DeleteItemConfirmDialog
        deleting={remove.isPending}
        item={itemPendingDelete}
        onCancel={() => {
          if (!remove.isPending) setItemPendingDelete(null);
        }}
        onConfirm={() => {
          if (itemPendingDelete && !remove.isPending) remove.mutate(itemPendingDelete.id);
        }}
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
                    label: "筛选物品",
                    onClick: () => setFilterOpen(true),
                  },
                  {
                    icon: <MoreHorizontal size={22} strokeWidth={2.3} />,
                    label: "更多选项",
                    onClick: () => setMoreMenuOpen((open) => !open),
                  },
                ]}
              />
              <PopoverMenu
                groups={[
                  // 桌面端把「添加物品」收进更多菜单；移动端保留右下角悬浮按钮。
                  ...(isDesktop
                    ? [
                        [
                          {
                            icon: <Plus size={18} />,
                            label: "添加物品",
                            onSelect: () => {
                              setMoreMenuOpen(false);
                              openEditor();
                            },
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
                      description: `${scrappedItems.length} 件`,
                      icon: <ArchiveX size={18} />,
                      label: "已报废",
                      onSelect: openScrappedItems,
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          )
        }
        description="登记每件物品的购买价与预用年限，记账时关联物品即可自动归集耗材开销，折算年均、月均成本。左滑可编辑或删除。"
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
        title={sortMode ? "拖动排序" : "物品管理"}
      >
        <div className="flex flex-col gap-3 pb-22">
          {itemsQuery.isPending || itemTypesQuery.isPending ? (
            <LoadingState rows={4} title="加载物品" />
          ) : items.length === 0 ? (
            <EmptyState
              message="把数码、家电、家具等大件录入，记账时关联，年均月均成本一目了然。"
              title="还没有添加物品"
            />
          ) : sortMode ? (
            <>
              <p className="px-1 text-xs text-[var(--color-text-muted)]">
                按住右侧图标拖动排序；物品类型整体移动，物品仅在所属类型内排序。
              </p>
              <ItemSortList
                collapsedIds={collapsedIds}
                groups={sortGroups}
                onReorderItems={handleReorderItems}
                onReorderTypes={handleReorderTypes}
              />
            </>
          ) : (
            <>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  平均月价
                </div>
                <p className="mt-1.5 flex items-baseline gap-0.5">
                  <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">
                    ¥
                  </span>
                  <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                    {formatMoney(avgMonthMicros)}
                  </span>
                </p>
                <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      平均年价
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {formatMoney(avgYearMicros)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      在用总价
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {formatMoney(totalValue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      在用件数
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {filteredItems.length} 件
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      耗材合计
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {formatMoney(consumablesTotal)}
                    </div>
                  </div>
                </div>
              </section>

              {filteredItems.length === 0 ? (
                <EmptyState message="调整筛选条件后再试。" title="没有符合条件的物品" />
              ) : (
                itemGroups.map((group) => {
                  const typeName = group.type?.name ?? "未分类";
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
                          {typeGlyph(group.type)}
                        </span>
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                          {typeName}
                        </span>
                        <span className="text-xs font-medium text-[var(--color-text-muted)]">
                          {group.items.length} 件
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
                aria-label="添加物品"
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
