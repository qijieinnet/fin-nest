"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type ItemAsset } from "@/lib/api";
import { useItems, useItemTypes } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
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
  itemTypeIcon,
  itemUsedYears,
} from "./_components/item-utils";

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  reached: "bg-[rgba(31,138,91,0.12)] text-[var(--color-accent-income)]",
  scrapped: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

export function ItemsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const itemsQuery = useItems(ledgerId);
  const itemTypesQuery = useItemTypes(ledgerId);
  const [itemPendingDelete, setItemPendingDelete] = useState<ItemAsset | null>(null);

  const items = itemsQuery.data ?? [];
  const itemTypes = itemTypesQuery.data ?? [];
  const active = items.filter((item) => !item.scrappedAt);
  const totalValue = active
    .reduce((sum, item) => sum + itemTotalMicros(item, BigInt(item.consumablesMicros ?? "0")), 0n)
    .toString();
  const consumablesTotal = items
    .reduce((sum, item) => sum + BigInt(item.consumablesMicros ?? "0"), 0n)
    .toString();

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
      className: "ui-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: <ItemEditorSheet item={item} itemTypes={itemTypes} ledgerId={ledgerId} />,
    });
  };

  const openScrapSheet = (item: ItemAsset) => {
    if (!ledgerId) return;
    push({
      hideDefaultHeader: true,
      content: <ItemScrapSheet item={item} ledgerId={ledgerId} />,
    });
  };

  const openDetail = (item: ItemAsset) => {
    if (!ledgerId) return;
    push({
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
    const typeName = itemTypes.find((type) => type.id === item.typeId)?.name ?? "其他";
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
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] text-[21px]">
            {itemTypeIcon(typeName)}
          </span>
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
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="添加物品"
            onClick={() => openEditor()}
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
        title="物品管理"
      >
        <div className="flex flex-col gap-3 pb-6">
          {itemsQuery.isPending ? (
            <LoadingState rows={4} title="加载物品" />
          ) : items.length === 0 ? (
            <EmptyState
              message="把数码、家电、家具等大件录入，记账时关联，年均月均成本一目了然。"
              title="还没有添加物品"
            />
          ) : (
            <>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] font-medium tracking-wide text-[var(--color-text-muted)]">
                  在用物品总价
                </div>
                <div className="mt-1 text-[30px] font-bold tracking-tight text-[var(--color-text-primary)]">
                  {formatMoney(totalValue)}
                </div>
                <div className="mt-3 flex gap-7">
                  <div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">在用件数</div>
                    <div className="mt-0.5 text-[15px] font-semibold text-[var(--color-text-primary)]">
                      {active.length} 件
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">耗材合计</div>
                    <div className="mt-0.5 text-[15px] font-semibold text-[var(--color-text-primary)]">
                      {formatMoney(consumablesTotal)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <div className="divide-y divide-black/[0.06]">{items.map(renderRow)}</div>
              </section>
            </>
          )}

          <button
            className="mt-1 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={() => openEditor()}
            type="button"
          >
            <Plus size={17} />
            添加物品
          </button>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
