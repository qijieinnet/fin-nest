"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  defaultFilterValue,
  EmptyState,
  filterButtonItem,
  FilterSheet,
  LoadingState,
  MoneyText,
} from "@/components/business";
import { Button, IconButton, IconButtonGroup, MobileAppShell } from "@/components/ui";
import type { Account, Transaction } from "@/lib/api";
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
import { NewBillFormScreen } from "./_components/NewBillFormScreen";
import { useBillsModel } from "./_model/useBillsModel";

type Row = {
  dateLabel: string;
  categoryIcon: string;
  categoryName: string;
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
      categoryName: "转账",
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
    categoryName: cat.categoryName ?? "未分类",
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

  // 全局快捷键 N：呼出记一笔 Modal（输入态与已有弹层时忽略）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (document.querySelector(".desktop-dialog-root")) return;
      event.preventDefault();
      openRecord();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openRecord]);

  const selected = transactions.find((t) => t.id === selectedId) ?? null;

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
          </div>
          <div className="flex items-center gap-2">
            <IconButtonGroup items={[filterButtonItem(model.filterValue, () => setFilterOpen(true))]} />
            <Button icon={<Plus size={16} />} onClick={openRecord} variant="primary">
              记一笔 <kbd className="desktop-kbd">N</kbd>
            </Button>
          </div>
        </header>

        <div className="desktop-bills__body">
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
                      <th>日期</th>
                      <th>分类</th>
                      <th>备注</th>
                      <th>人员</th>
                      <th>账户</th>
                      <th className="desktop-table__amount">金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => {
                      const row = toRow(transaction, accounts, categoryLookup);
                      return (
                        <tr
                          className={`desktop-table__row${transaction.id === selectedId ? " desktop-table__row--selected" : ""}`}
                          key={transaction.id}
                          onClick={() => selectTx(transaction.id)}
                        >
                          <td className="desktop-table__date">{row.dateLabel}</td>
                          <td>
                            <span className="mr-1.5">{row.categoryIcon}</span>
                            {row.categoryName}
                          </td>
                          <td className="desktop-table__muted truncate">{row.note || "—"}</td>
                          <td className="desktop-table__muted">{row.personName || "—"}</td>
                          <td className="desktop-table__muted truncate">{row.accountLabel || "—"}</td>
                          <td className="desktop-table__amount">
                            <MoneyText
                              amountMicros={row.amountMicros}
                              tone={row.isTransfer ? "neutral" : transaction.type === "income" ? "income" : "expense"}
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

          <aside className="desktop-bills__detail">
            {selected ? (
              <TxDetailPanel
                accounts={accounts}
                categoryLookup={categoryLookup}
                decimalPlaces={decimalPlaces}
                onDelete={() => model.setTransactionPendingDelete(selected)}
                onEdit={() => openEdit(selected.id)}
                transaction={selected}
              />
            ) : (
              <div className="desktop-empty-pane">
                <EmptyState title="选择左侧交易查看详情" />
              </div>
            )}
          </aside>
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
        className="desktop-bills__figure-value"
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
  onDelete,
  onEdit,
  transaction,
}: {
  accounts: Account[];
  categoryLookup: CategoryLookup;
  decimalPlaces: number;
  onDelete: () => void;
  onEdit: () => void;
  transaction: Transaction;
}) {
  const row = toRow(transaction, accounts, categoryLookup);
  const rows: Array<{ label: string; value: string }> = [
    { label: "日期", value: (transaction.occurredOn ?? "").slice(0, 10) },
    { label: "分类", value: `${row.categoryIcon} ${row.categoryName}` },
    { label: "账户", value: row.accountLabel || "—" },
    ...(row.isTransfer ? [] : [{ label: "人员", value: row.personName || "—" }]),
    { label: "备注", value: row.note || "—" },
  ];
  return (
    <div className="desktop-detail-scroll">
      <div className="mb-4 flex items-start justify-between gap-3">
        <MoneyText
          amountMicros={transaction.grossAmountMicros}
          className="text-[28px] font-bold [font-variant-numeric:tabular-nums]"
          tone={row.isTransfer ? "neutral" : transaction.type === "income" ? "income" : "expense"}
        />
        <div className="flex items-center gap-1">
          <IconButton icon={<Pencil size={18} />} label="编辑" onClick={onEdit} />
          <IconButton icon={<Trash2 size={18} />} label="删除" onClick={onDelete} />
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
