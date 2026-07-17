"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import type { AiCard, AiDraftFields } from "@/lib/api";
import { formatMicros } from "@/lib/money";

const TYPE_LABEL: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
};

// 金额配色与账单行一致（TransactionRow / desktop-amount 同款翻转）：支出绿色 / 收入红色 / 转账黄色。
const TYPE_COLOR: Record<string, string> = {
  expense: "var(--color-accent-income)",
  income: "var(--color-accent-expense)",
  transfer: "var(--color-accent-transfer)",
};

function amount(micros: string): string {
  return formatMicros(micros, { currencySymbol: "¥" });
}

function DraftRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-[var(--color-text-muted)]">{label}</span>
      <span className="truncate text-right text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

/** 记账草稿卡：展示 AI 解析结果，用户点确认才真正入账。 */
export function TransactionDraftCard({
  card,
  confirming,
  disabled = false,
  onConfirm,
  onEdit,
}: {
  card: Extract<AiCard, { kind: "transaction_draft" }>;
  confirming: boolean;
  /** 流式生成中消息尚未持久化（无 messageId），按钮暂不可用。 */
  disabled?: boolean;
  onConfirm: () => void;
  /** 带草稿跳转记一笔表单（预填后手动补充/修改再保存）。 */
  onEdit?: () => void;
}) {
  const draft: AiDraftFields = card.draft;
  const confirmed = card.status === "confirmed";
  const accountText =
    draft.type === "transfer"
      ? [draft.fromAccountName ?? "未指定", draft.toAccountName ?? "未指定"].join(" → ")
      : draft.accountName
        ? draft.subAccountName
          ? `${draft.accountName} · ${draft.subAccountName}`
          : draft.accountName
        : undefined;
  const categoryText = draft.categoryName
    ? draft.subcategoryName
      ? `${draft.categoryName} · ${draft.subcategoryName}`
      : draft.categoryName
    : undefined;

  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-bold"
          style={{
            backgroundColor: "var(--color-control-fill-muted, rgba(0,0,0,0.05))",
            color: TYPE_COLOR[draft.type],
          }}
        >
          {TYPE_LABEL[draft.type] ?? draft.type}
        </span>
        <span className="text-[20px] font-bold" style={{ color: TYPE_COLOR[draft.type] }}>
          {amount(draft.grossAmountMicros)}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <DraftRow label="日期" value={draft.occurredOn} />
        <DraftRow label="分类" value={categoryText} />
        <DraftRow label="账户" value={accountText} />
        <DraftRow label="人员" value={draft.personName} />
        <DraftRow label="备注" value={draft.note} />
      </div>
      <div className="mt-3">
        {confirmed ? (
          <Button block disabled icon={<Check size={16} />} variant="secondary">
            已记账
          </Button>
        ) : (
          <div className="flex gap-2">
            {onEdit ? (
              <Button
                className="flex-1"
                disabled={disabled || confirming}
                onClick={onEdit}
                variant="secondary"
              >
                去编辑
              </Button>
            ) : null}
            <Button
              className="flex-[2]"
              disabled={disabled}
              loading={confirming}
              onClick={onConfirm}
            >
              确认入账
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 查询结果卡：明细列表 + 合计。 */
export function TransactionsCard({
  card,
}: {
  card: Extract<AiCard, { kind: "transactions" }>;
}) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-[var(--color-text-primary)]">{card.title}</p>
        <p className="shrink-0 text-xs text-[var(--color-text-muted)]">共 {card.count} 笔</p>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-[var(--color-text-muted)]">
        {card.expenseMicros !== "0" ? <span>支出 {amount(card.expenseMicros)}</span> : null}
        {card.incomeMicros !== "0" ? <span>收入 {amount(card.incomeMicros)}</span> : null}
      </div>
      {card.rows.length > 0 ? (
        <div className="mt-3 flex flex-col divide-y divide-black/[0.04]">
          {card.rows.map((row, index) => (
            <div className="flex items-center justify-between gap-3 py-2 text-sm" key={index}>
              <div className="min-w-0">
                <p className="truncate text-[var(--color-text-primary)]">
                  {row.categoryName ?? TYPE_LABEL[row.type] ?? row.type}
                </p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">
                  {row.occurredOn}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold" style={{ color: TYPE_COLOR[row.type] }}>
                {amount(row.grossAmountMicros)}
              </span>
            </div>
          ))}
          {card.count > card.rows.length ? (
            <p className="pt-2 text-center text-xs text-[var(--color-text-muted)]">
              仅展示前 {card.rows.length} 笔
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">没有符合条件的交易</p>
      )}
    </div>
  );
}

/** 月度统计卡：收支总额 + 支出分类 Top。 */
export function StatsMonthCard({ card }: { card: Extract<AiCard, { kind: "stats_month" }> }) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-4">
      <p className="font-bold text-[var(--color-text-primary)]">{card.month} 月度统计</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">支出</p>
          <p className="text-[18px] font-bold" style={{ color: TYPE_COLOR.expense }}>
            {amount(card.expenseMicros)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">收入</p>
          <p className="text-[18px] font-bold" style={{ color: TYPE_COLOR.income }}>
            {amount(card.incomeMicros)}
          </p>
        </div>
      </div>
      {card.topExpenseCategories.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {card.topExpenseCategories.map((item, index) => (
            <div className="flex items-baseline justify-between gap-3 text-sm" key={index}>
              <span className="truncate text-[var(--color-text-primary)]">{item.name}</span>
              <span className="shrink-0 text-[var(--color-text-secondary)]">
                {amount(item.amountMicros)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
