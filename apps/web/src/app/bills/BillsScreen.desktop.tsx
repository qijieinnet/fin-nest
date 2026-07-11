"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  defaultFilterValue,
  EmptyState,
  filterButtonItem,
  FilterSheet,
  LoadingState,
  MoneyText,
} from "@/components/business";
import { IconButton, IconButtonGroup, MobileAppShell, PopoverMenu } from "@/components/ui";
import type { Account, BatchUpdateField, Transaction } from "@/lib/api";
import {
  accountName,
  type CategoryLookup,
  categoryRowProps,
  TRANSFER_ICON,
} from "@/lib/data/options";
import { formatMicros } from "@/lib/money";
import { useDecimalPlaces, useSheetStack } from "@/providers";
import { DeleteBillConfirmDialog } from "./_components/DeleteBillConfirmDialog";
import { EditBillScreen } from "./[transactionId]/edit/EditBillScreen";
import { BatchEditDialog, type BatchFieldPatch } from "./_components/BatchEditDialog";
import { NewBillFormScreen } from "./_components/NewBillFormScreen";
import { useBillsModel } from "./_model/useBillsModel";

const BATCH_FIELD_ITEMS: Array<{ field: BatchUpdateField; label: string }> = [
  { field: "category", label: "分类" },
  { field: "account", label: "账户" },
  { field: "person", label: "人员" },
  { field: "occurredOn", label: "日期" },
  { field: "note", label: "备注" },
];

type Row = {
  dateLabel: string;
  categoryIcon: string;
  /** 小类（子分类，无子分类时回退父分类）。 */
  subcategoryName: string;
  /** 大类（父分类）。 */
  parentCategoryName: string;
  note: string;
  personName: string;
  accountLabel: string;
  amountMicros: string;
  isTransfer: boolean;
};

function toRow(
  transaction: Transaction,
  accounts: Account[],
  categoryLookup: CategoryLookup,
): Row {
  const dateLabel = (transaction.occurredOn ?? "").slice(0, 10).replaceAll("-", "/").slice(5);
  if (transaction.type === "transfer") {
    const from = accountName(accounts, transaction.fromAccountId);
    const to = accountName(accounts, transaction.toAccountId);
    return {
      dateLabel,
      categoryIcon: TRANSFER_ICON,
      subcategoryName: "转账",
      parentCategoryName: "转账",
      note: transaction.note ?? "",
      personName: "",
      accountLabel: from && to ? `${from} → ${to}` : "",
      amountMicros: transaction.grossAmountMicros,
      isTransfer: true,
    };
  }
  const cat = categoryRowProps(transaction, categoryLookup);
  return {
    dateLabel,
    categoryIcon: cat.categoryIcon ?? "🧾",
    subcategoryName: cat.title || "未分类",
    parentCategoryName: cat.categoryName || "未分类",
    note: transaction.note ?? "",
    personName: transaction.personSnapshot?.name ?? "",
    accountLabel: accountName(accounts, transaction.accountId) ?? "",
    amountMicros: transaction.grossAmountMicros,
    isTransfer: false,
  };
}

/** 桌面账单页：左侧交易表格（无限滚动）+ 右侧详情面板；顶部汇总条 + 记一笔（N 快捷键）。 */
export function BillsScreenDesktop() {
  const { push, clear } = useSheetStack();
  const decimalPlaces = useDecimalPlaces();
  const [filterOpen, setFilterOpen] = useState(false);

  const model = useBillsModel();
  const { totals, transactions, accounts, categoryLookup } = model;
  const balanceMicros = model.balanceMicros;

  // 桌面屏仅在客户端断点检测后挂载，window 一定可用；初始选中读 ?tx。
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("tx"),
  );

  // 批量修改：多选行 + 当前打开的字段编辑弹窗。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchField, setBatchField] = useState<BatchUpdateField | null>(null);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBatchMenuOpen(false);
  }, []);
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 选中项写回 URL（?tx=<id>），不做整页跳转。
  const selectTx = useCallback((id: string | null) => {
    setSelectedId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("tx", id);
    else params.delete("tx");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const openRecord = useCallback(() => {
    push({
      className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: <NewBillFormScreen embedded onClose={() => clear()} onSaved={() => clear()} />,
    });
  }, [push, clear]);

  const openEdit = useCallback(
    (id: string) => {
      push({
        className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
        hideDefaultHeader: true,
        content: <EditBillScreen embedded onClose={() => clear()} transactionId={id} />,
      });
    },
    [push, clear],
  );

  // 全局快捷键：N 记一笔、/ 打开筛选（输入态与已有弹层时忽略）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isRecord = event.key === "n" || event.key === "N";
      const isFilter = event.key === "/";
      if (!isRecord && !isFilter) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (document.querySelector(".desktop-dialog-root")) return;
      event.preventDefault();
      if (isRecord) openRecord();
      else setFilterOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openRecord]);

  const selected = transactions.find((t) => t.id === selectedId) ?? null;

  const allLoadedSelected =
    transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0 && !allLoadedSelected;
  // 勾选是否全为转账：决定操作菜单是否显示「修改分类」、账户改为转出/转入两侧。
  const selectedAllTransfer =
    selectedIds.size > 0 &&
    transactions.filter((t) => selectedIds.has(t.id)).every((t) => t.type === "transfer");
  const batchFieldItems = selectedAllTransfer
    ? BATCH_FIELD_ITEMS.filter((item) => item.field !== "category")
    : BATCH_FIELD_ITEMS;
  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (transactions.length > 0 && transactions.every((t) => prev.has(t.id))) return new Set();
      return new Set(transactions.map((t) => t.id));
    });
  }, [transactions]);

  const submitBatch = useCallback(
    (patch: BatchFieldPatch) => {
      model.batchUpdateMutation.mutate(
        { transactionIds: [...selectedIds], ...patch },
        {
          onSuccess: () => {
            setBatchField(null);
            clearSelection();
          },
        },
      );
    },
    [model.batchUpdateMutation, selectedIds, clearSelection],
  );

  return (
    <MobileAppShell>
      <div className="desktop-bills desktop-page--wide">
        <header className="desktop-bills__summary">
          <div className="desktop-bills__summary-figures">
            <Figure label="支出" micros={totals.expenseMicros} tone="expense" decimalPlaces={decimalPlaces} />
            <Figure label="收入" micros={totals.incomeMicros} tone="income" decimalPlaces={decimalPlaces} />
            <Figure label="结余" micros={balanceMicros} tone="neutral" decimalPlaces={decimalPlaces} />
            <div className="desktop-bills__figure">
              <span className="desktop-bills__figure-label">条数</span>
              <span className="desktop-bills__figure-value [font-variant-numeric:tabular-nums]">
                {totals.count}
              </span>
            </div>
            {model.showBudget && model.budget ? (
              <div className="desktop-bills__budget">
                <span className="desktop-bills__figure-label">
                  本月预算剩余{" "}
                  <MoneyText
                    amountMicros={model.budget.total.remainingMicros ?? "0"}
                    className="text-[11px]"
                    tone={
                      model.budget.total.remainingMicros &&
                      BigInt(model.budget.total.remainingMicros) < 0n
                        ? "expense"
                        : "muted"
                    }
                  />
                </span>
                <span className="desktop-bills__budget-track">
                  <span
                    className="desktop-bills__budget-fill"
                    style={{ width: `${Math.min(model.budget.total.percent, 100)}%` }}
                  />
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 ? (
              <div className="desktop-batch-op">
                <span className="desktop-batch-op__count">已选 {selectedIds.size} 笔</span>
                <div className="relative">
                  <button
                    className="desktop-batch-op__button"
                    onClick={() => setBatchMenuOpen((open) => !open)}
                    type="button"
                  >
                    操作
                  </button>
                  <PopoverMenu
                    groups={[
                      batchFieldItems.map((item) => ({
                        label: `修改${item.label}`,
                        onSelect: () => {
                          setBatchField(item.field);
                          setBatchMenuOpen(false);
                        },
                      })),
                      [{ label: "取消选择", onSelect: clearSelection }],
                    ]}
                    onOpenChange={setBatchMenuOpen}
                    open={batchMenuOpen}
                  />
                </div>
              </div>
            ) : null}
            <IconButtonGroup items={[filterButtonItem(model.filterValue, () => setFilterOpen(true))]} />
            <button
              aria-label="记一笔"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-tint-contrast)] shadow-[var(--shadow-soft)]"
              onClick={openRecord}
              title="记一笔（N）"
              type="button"
            >
              <Plus size={20} />
            </button>
          </div>
        </header>

        <div className={`desktop-bills__body${selected ? "" : " desktop-bills__body--full"}`}>
          <section className="desktop-bills__table-wrap">
            {model.transactionsQuery.isPending ? (
              <LoadingState rows={6} title="加载账单" />
            ) : transactions.length === 0 ? (
              <EmptyState title="暂无数据" />
            ) : (
              <div className="desktop-table-scroll">
                <table className="desktop-table">
                  <thead>
                    <tr>
                      <th className="desktop-table__check">
                        <input
                          aria-label="全选当前加载的记账"
                          checked={allLoadedSelected}
                          onChange={toggleAll}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          type="checkbox"
                        />
                      </th>
                      <th>日期</th>
                      <th>小类</th>
                      <th>大类</th>
                      <th>人员</th>
                      <th>账户</th>
                      <th>备注</th>
                      <th className="desktop-table__amount">金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => {
                      const row = toRow(transaction, accounts, categoryLookup);
                      const checked = selectedIds.has(transaction.id);
                      return (
                        <tr
                          className={`desktop-table__row${transaction.id === selectedId ? " desktop-table__row--selected" : ""}${checked ? " desktop-table__row--checked" : ""}`}
                          key={transaction.id}
                          onClick={() => selectTx(transaction.id)}
                        >
                          <td
                            className="desktop-table__check"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              aria-label="选择该记账"
                              checked={checked}
                              onChange={() => toggleRow(transaction.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="desktop-table__date">{row.dateLabel}</td>
                          <td>
                            <span className="mr-1.5">{row.categoryIcon}</span>
                            {row.subcategoryName}
                          </td>
                          <td className="desktop-table__muted">{row.parentCategoryName || "—"}</td>
                          <td className="desktop-table__muted">{row.personName || "—"}</td>
                          <td className="desktop-table__muted truncate">{row.accountLabel || "—"}</td>
                          <td className="desktop-table__muted truncate">{row.note || "—"}</td>
                          <td className="desktop-table__amount">
                            <MoneyText
                              amountMicros={row.amountMicros}
                              className="desktop-amount"
                              tone={transaction.type}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div ref={model.sentinelRef} />
                {model.isFetchingNextPage ? (
                  <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">加载中…</p>
                ) : !model.hasNextPage ? (
                  <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">没有更多了</p>
                ) : null}
              </div>
            )}
          </section>

          {selected ? (
            <aside className="desktop-bills__detail">
              <TxDetailPanel
                accounts={accounts}
                categoryLookup={categoryLookup}
                decimalPlaces={decimalPlaces}
                onClose={() => selectTx(null)}
                onDelete={() => model.setTransactionPendingDelete(selected)}
                onEdit={() => openEdit(selected.id)}
                transaction={selected}
              />
            </aside>
          ) : null}
        </div>
      </div>

      <FilterSheet
        accountOptions={model.filterAccountOptions}
        categoryOptions={model.filterCategoryOptions}
        fields={["type", "dateRange", "category", "account", "person", "amountRange", "keyword"]}
        onApply={() => undefined}
        onChange={model.setFilterValue}
        onOpenChange={setFilterOpen}
        onReset={() => model.setFilterValue(defaultFilterValue)}
        open={filterOpen}
        personOptions={model.filterPersonOptions}
        value={model.filterValue}
      />

      <DeleteBillConfirmDialog
        deleting={model.deleteMutation.isPending}
        onCancel={() => {
          if (!model.deleteMutation.isPending) model.setTransactionPendingDelete(null);
        }}
        onConfirm={() => {
          if (model.transactionPendingDelete && !model.deleteMutation.isPending) {
            const removedId = model.transactionPendingDelete.id;
            model.deleteMutation.mutate(removedId);
            if (removedId === selectedId) selectTx(null);
          }
        }}
        transaction={model.transactionPendingDelete}
      />

      <BatchEditDialog
        accounts={accounts}
        allTransfer={selectedAllTransfer}
        categoryOptions={model.filterCategoryOptions}
        count={selectedIds.size}
        field={batchField}
        onClose={() => setBatchField(null)}
        onSubmit={submitBatch}
        personOptions={model.filterPersonOptions}
        submitting={model.batchUpdateMutation.isPending}
      />
    </MobileAppShell>
  );
}

function Figure({
  decimalPlaces,
  label,
  micros,
  tone,
}: {
  decimalPlaces: number;
  label: string;
  micros: bigint;
  tone: "expense" | "income" | "neutral";
}) {
  return (
    <div className="desktop-bills__figure">
      <span className="desktop-bills__figure-label">{label}</span>
      <MoneyText
        amountMicros={micros}
        className="desktop-amount desktop-bills__figure-value"
        showPositiveSign={tone === "neutral"}
        tone={tone}
      />
      <span className="sr-only">{formatMicros(micros, { decimalPlaces })}</span>
    </div>
  );
}

function TxDetailPanel({
  accounts,
  categoryLookup,
  onClose,
  onDelete,
  onEdit,
  transaction,
}: {
  accounts: Account[];
  categoryLookup: CategoryLookup;
  decimalPlaces: number;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  transaction: Transaction;
}) {
  const row = toRow(transaction, accounts, categoryLookup);
  const rows: Array<{ label: string; value: string }> = [
    { label: "日期", value: (transaction.occurredOn ?? "").slice(0, 10) },
    { label: "小类", value: `${row.categoryIcon} ${row.subcategoryName}` },
    { label: "大类", value: row.parentCategoryName || "—" },
    { label: "账户", value: row.accountLabel || "—" },
    ...(row.isTransfer ? [] : [{ label: "人员", value: row.personName || "—" }]),
    { label: "备注", value: row.note || "—" },
  ];
  return (
    <div className="desktop-detail-scroll">
      <div className="mb-4 flex items-start justify-between gap-3">
        <MoneyText
          amountMicros={transaction.grossAmountMicros}
          className="desktop-amount text-[28px] font-bold [font-variant-numeric:tabular-nums]"
          tone={transaction.type}
        />
        <div className="flex items-center gap-1">
          <IconButton icon={<Pencil size={18} />} label="编辑" onClick={onEdit} />
          <IconButton icon={<Trash2 size={18} />} label="删除" onClick={onDelete} />
          <IconButton icon={<X size={18} />} label="关闭" onClick={onClose} />
        </div>
      </div>
      <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
        {rows.map((r) => (
          <div
            className="flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
            key={r.label}
          >
            <span className="w-16 shrink-0 text-sm text-[var(--color-text-muted)]">{r.label}</span>
            <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
