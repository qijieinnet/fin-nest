"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { IconButton, IconButtonGroup, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type ItemAsset } from "@/lib/api";
import { useItems, useItemTypes } from "@/lib/data/records";
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
import {
  formatDateLabel,
  formatFixed1,
  formatMoney,
  itemStatus,
  itemTotalMicros,
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
  { id: "scrapped", label: "已报废" },
];

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

export function ItemsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const itemsQuery = useItems(ledgerId);
  const itemTypesQuery = useItemTypes(ledgerId);
  const [itemPendingDelete, setItemPendingDelete] = useState<ItemAsset | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});

  const items = itemsQuery.data ?? [];
  const itemTypes = itemTypesQuery.data ?? [];
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const itemTypeById = new Map(itemTypes.map((type) => [type.id, type]));
  const hasUncategorizedItems = items.some(
    (item) => !item.typeId || !itemTypeById.has(item.typeId),
  );
  const itemFilterOptions: AssetFilterOption[] = [
    ...itemTypes.map((type) => ({ icon: typeGlyph(type), id: type.id, label: type.name })),
    ...(hasUncategorizedItems
      ? [{ icon: typeGlyph(null), id: "uncategorized", label: "未分类" }]
      : []),
  ];
  const amountMinMicros = parseFilterMoney(filterValue.amountMin, decimalPlaces);
  const amountMaxMicros = parseFilterMoney(filterValue.amountMax, decimalPlaces);
  const keyword = filterValue.keyword?.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const categoryId = item.typeId && itemTypeById.has(item.typeId) ? item.typeId : "uncategorized";
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
  const active = filteredItems.filter((item) => !item.scrappedAt);
  const totalValue = active
    .reduce((sum, item) => sum + itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0")), 0n)
    .toString();
  const consumablesTotal = filteredItems
    .reduce((sum, item) => sum + BigInt(item.consumablesMicros ?? "0"), 0n)
    .toString();
  const uncategorizedItems = filteredItems.filter(
    (item) => !item.typeId || !itemTypeById.has(item.typeId),
  );
  const itemGroups = [
    ...itemTypes
      .map((type) => ({
        key: type.id,
        type,
        items: filteredItems.filter((item) => item.typeId === type.id),
      }))
      .filter((group) => group.items.length > 0),
    ...(uncategorizedItems.length > 0
      ? [
          {
            key: "uncategorized",
            type: null,
            items: uncategorizedItems,
          },
        ]
      : []),
  ];

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
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
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
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const goBack = () => {
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
    const metaText = [typeName, item.purchaseDate ? formatDateLabel(item.purchaseDate) : null]
      .filter(Boolean)
      .join(" · ");
    const total = itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0"));
    const usedText = item.purchaseDate
      ? `用 ${formatFixed1(itemUsedYears(item))} 年`
      : "未填购买日";
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
      <SwipeActionRow actions={actions} key={item.id}>
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
          <IconButtonGroup
            items={[
              {
                dot: activeFilterCount > 0,
                icon: <SlidersHorizontal size={20} strokeWidth={2.2} />,
                label: "筛选物品",
                onClick: () => setFilterOpen(true),
              },
              {
                icon: <Plus size={22} strokeWidth={2.3} />,
                label: "添加物品",
                onClick: () => openEditor(),
              },
            ]}
          />
        }
        description="登记每件物品的购买价与预用年限，记账时关联物品即可自动归集耗材开销，折算年均、月均成本。左滑可编辑或删除。"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title="物品管理"
      >
        <div className="flex flex-col gap-3 pb-6">
          {itemsQuery.isPending || itemTypesQuery.isPending ? (
            <LoadingState rows={4} title="加载物品" />
          ) : items.length === 0 ? (
            <EmptyState
              message="把数码、家电、家具等大件录入，记账时关联，年均月均成本一目了然。"
              title="还没有添加物品"
            />
          ) : (
            <>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  在用物品总价
                </div>
                <p className="mt-1.5 flex items-baseline gap-0.5">
                  <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">
                    ¥
                  </span>
                  <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                    {formatMoney(totalValue)}
                  </span>
                </p>
                <div className="mt-3.5 flex gap-7">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      在用件数
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">{active.length} 件</div>
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

                  return (
                    <section
                      className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                      key={group.key}
                    >
                      <div className="flex items-center gap-2 px-4 py-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                          {typeGlyph(group.type)}
                        </span>
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                          {typeName}
                        </span>
                        <span className="text-xs font-medium text-[var(--color-text-muted)]">
                          {group.items.length} 件
                        </span>
                      </div>
                      <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                        {group.items.map(renderRow)}
                      </div>
                    </section>
                  );
                })
              )}
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
