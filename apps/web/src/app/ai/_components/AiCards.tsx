"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { CategoryIcon } from "@/components/business";
import { Button, Tabs } from "@/components/ui";
import type { AiCard, AiDraftFields } from "@/lib/api";
import { formatMicros } from "@/lib/money";
import { useLedger } from "@/providers";

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

// 与统计页的分类色带保持一致。
const STATS_PALETTE = [
  "oklch(0.70 0.16 25)",
  "oklch(0.74 0.15 55)",
  "oklch(0.80 0.14 90)",
  "oklch(0.75 0.15 140)",
  "oklch(0.72 0.13 185)",
  "oklch(0.66 0.15 245)",
  "oklch(0.62 0.17 290)",
  "oklch(0.68 0.17 330)",
];

function currencySymbol(currency = "CNY"): string {
  const known: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
  return known[currency] ?? `${currency} `;
}

function amount(micros: string, currency?: string): string {
  return formatMicros(micros, { currencySymbol: currencySymbol(currency) });
}

type TrendAmountUnit = "yuan" | "thousand" | "tenThousand";

function trendAmountUnit(maxMicros: bigint): TrendAmountUnit {
  if (maxMicros >= 10_000_000_000n) return "tenThousand";
  if (maxMicros >= 1_000_000_000n) return "thousand";
  return "yuan";
}

/** 与统计页趋势图一致的紧凑数值，全程使用 bigint 避免金额精度损失。 */
function compactTrendValue(micros: bigint, unit: TrendAmountUnit): string {
  const value = micros < 0n ? -micros : micros;
  const sign = micros < 0n ? "-" : "";
  if (unit === "tenThousand") {
    const tenths = (value + 500_000_000n) / 1_000_000_000n;
    return `${sign}${tenths / 10n}.${tenths % 10n}`;
  }
  if (unit === "thousand") {
    const tenths = (value + 50_000_000n) / 100_000_000n;
    return `${sign}${tenths / 10n}.${tenths % 10n}`;
  }
  return `${sign}${(value + 500_000n) / 1_000_000n}`;
}

function useCardCurrency(currency?: string): string {
  const { currentLedger } = useLedger();
  return currency ?? currentLedger?.currency ?? "CNY";
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
  voiding = false,
  disabled = false,
  onConfirm,
  onEdit,
  onVoid,
}: {
  card: Extract<AiCard, { kind: "transaction_draft" }>;
  confirming: boolean;
  /** 正在作废该草稿，按钮 loading 态并防连点。 */
  voiding?: boolean;
  /** 流式生成中消息尚未持久化（无 messageId），按钮暂不可用。 */
  disabled?: boolean;
  onConfirm: () => void;
  /** 带草稿跳转记一笔表单（预填后手动补充/修改再保存）。 */
  onEdit?: () => void;
  /** 手动作废草稿（不入账）。 */
  onVoid?: () => void;
}) {
  const draft: AiDraftFields = card.draft;
  const currency = useCardCurrency(draft.currency);
  const confirmed = card.status === "confirmed";
  const superseded = card.status === "superseded";
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
    <div className={`ai-card${superseded ? " opacity-60" : ""}`}>
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
        <span
          className="text-[20px] font-bold"
          style={{
            color: TYPE_COLOR[draft.type],
            textDecoration: superseded ? "line-through" : undefined,
          }}
        >
          {amount(draft.grossAmountMicros, currency)}
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
        ) : superseded ? (
          <p className="text-center text-xs text-[var(--color-text-muted)]">已作废（已被更正）</p>
        ) : card.confirmationBlockedReason ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              {card.confirmationBlockedReason}
            </p>
            <div className="flex gap-2">
              {onVoid ? (
                <Button
                  className="flex-1"
                  disabled={disabled || confirming || voiding}
                  loading={voiding}
                  onClick={onVoid}
                  variant="secondary"
                >
                  作废
                </Button>
              ) : null}
              {onEdit ? (
                <Button
                  className="flex-1"
                  disabled={disabled || confirming || voiding}
                  onClick={onEdit}
                  variant="secondary"
                >
                  编辑
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {onVoid ? (
              <Button
                className="flex-1"
                disabled={disabled || confirming || voiding}
                loading={voiding}
                onClick={onVoid}
                variant="secondary"
              >
                作废
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                className="flex-1"
                disabled={disabled || confirming || voiding}
                onClick={onEdit}
                variant="secondary"
              >
                编辑
              </Button>
            ) : null}
            <Button
              className="flex-[2]"
              disabled={disabled || voiding}
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
export function TransactionsCard({ card }: { card: Extract<AiCard, { kind: "transactions" }> }) {
  const currency = useCardCurrency(card.currency);
  return (
    <div className="ai-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-[var(--color-text-primary)]">{card.title}</p>
        <p className="shrink-0 text-xs text-[var(--color-text-muted)]">共 {card.count} 笔</p>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-[var(--color-text-muted)]">
        {card.expenseMicros !== "0" ? (
          <span>支出 {amount(card.expenseMicros, currency)}</span>
        ) : null}
        {card.incomeMicros !== "0" ? <span>收入 {amount(card.incomeMicros, currency)}</span> : null}
      </div>
      {card.rows.length > 0 ? (
        <div className="mt-3 flex flex-col divide-y divide-black/[0.04]">
          {card.rows.map((row, index) => (
            <div className="flex items-center justify-between gap-3 py-2 text-sm" key={index}>
              <div className="min-w-0">
                <p className="truncate text-[var(--color-text-primary)]">
                  {row.subcategoryName ?? row.categoryName ?? TYPE_LABEL[row.type] ?? row.type}
                </p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">
                  {row.occurredOn}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold" style={{ color: TYPE_COLOR[row.type] }}>
                {amount(row.effectiveAmountMicros ?? row.grossAmountMicros ?? "0", currency)}
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
  const currency = useCardCurrency(card.currency);
  return (
    <div className="ai-card">
      <p className="font-bold text-[var(--color-text-primary)]">{card.month} 月度统计</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">支出</p>
          <p className="text-[18px] font-bold" style={{ color: TYPE_COLOR.expense }}>
            {amount(card.expenseMicros, currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">收入</p>
          <p className="text-[18px] font-bold" style={{ color: TYPE_COLOR.income }}>
            {amount(card.incomeMicros, currency)}
          </p>
        </div>
      </div>
      {card.topExpenseCategories.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {card.topExpenseCategories.map((item, index) => (
            <div className="flex items-baseline justify-between gap-3 text-sm" key={index}>
              <span className="truncate text-[var(--color-text-primary)]">{item.name}</span>
              <span className="shrink-0 text-[var(--color-text-secondary)]">
                {amount(item.amountMicros, currency)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type PeriodCategory = Extract<AiCard, { kind: "stats_period" }>["expenseCategories"][number];

function categoryPercent(amountMicros: string, totalMicros: bigint): number {
  if (totalMicros <= 0n) return 0;
  return Number((BigInt(amountMicros) * 1000n) / totalMicros) / 10;
}

function StatsCategoryDonut({
  categories,
  currency,
  totalMicros,
  type,
}: {
  categories: Extract<AiCard, { kind: "stats_period" }>["expenseCategories"];
  currency: string;
  totalMicros: string;
  type: "expense" | "income";
}) {
  const total = BigInt(totalMicros);
  let cursor = 0;
  const gradient =
    total > 0n
      ? categories
          .map((category, index) => {
            const start = cursor;
            const size = categoryPercent(category.amountMicros, total);
            cursor = index === categories.length - 1 ? 100 : Math.min(cursor + size, 100);
            return `${STATS_PALETTE[index % STATS_PALETTE.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
          })
          .join(", ")
      : "var(--color-control-fill-muted) 0% 100%";

  return (
    <div className="mt-3 flex items-center gap-4 rounded-[16px] bg-[var(--color-control-fill-muted)] p-3">
      <div className="relative h-28 w-28 shrink-0">
        <div
          aria-label={`${TYPE_LABEL[type]}分类饼图`}
          className="absolute inset-0 rounded-full"
          role="img"
          style={{ background: `conic-gradient(${gradient})` }}
        />
        <div className="absolute inset-[17px] flex flex-col items-center justify-center rounded-full bg-[var(--color-bg-surface)]">
          <span className="text-[10px] text-[var(--color-text-muted)]">总{TYPE_LABEL[type]}</span>
          <span className="mt-0.5 max-w-[76px] truncate text-[15px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
            {amount(totalMicros, currency)}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {categories.length > 0 ? (
          categories.slice(0, 5).map((category, index) => (
            <div className="flex items-center gap-2" key={`${category.name}:${index}`}>
              <span
                className="h-[9px] w-[9px] shrink-0 rounded-[3px]"
                style={{ background: STATS_PALETTE[index % STATS_PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">
                {category.name}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                {Math.round(categoryPercent(category.amountMicros, total))}%
              </span>
            </div>
          ))
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">暂无分类数据</span>
        )}
      </div>
    </div>
  );
}

function CategorySummary({
  categories,
  currency,
  totalMicros,
  type,
}: {
  categories: PeriodCategory[];
  currency: string;
  totalMicros: string;
  type: "expense" | "income";
}) {
  const total = BigInt(totalMicros);
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
        {TYPE_LABEL[type]}分类汇总
      </p>
      {categories.length > 0 ? (
        <div className="flex flex-col divide-y divide-black/[0.04]">
          {categories.map((category, index) => (
            <div className="flex items-center gap-3 py-2.5" key={`${category.name}:${index}`}>
              <CategoryIcon
                color={STATS_PALETTE[index % STATS_PALETTE.length]}
                icon={category.icon ?? undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {category.name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                    {amount(category.amountMicros, currency)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  占比 {categoryPercent(category.amountMicros, total).toFixed(1)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-3 text-sm text-[var(--color-text-muted)]">暂无分类数据</p>
      )}
    </div>
  );
}

function StatsTrendChart({
  card,
  currency,
  type,
}: {
  card: Extract<AiCard, { kind: "stats_period" }>;
  currency: string;
  type: "expense" | "income";
}) {
  const points = card.trend?.points ?? [];
  if (points.length < 2) return null;
  const values = points.map((point) =>
    BigInt(type === "expense" ? point.expenseMicros : point.incomeMicros),
  );
  const max = values.reduce((current, value) => (value > current ? value : current), 0n);
  const displayUnit = trendAmountUnit(max);
  const displayUnitLabel =
    displayUnit === "tenThousand" ? "万元" : displayUnit === "thousand" ? "千元" : "元";
  const width = 320;
  const height = 164;
  const padX = 10;
  const padTop = 38;
  const padBottom = 28;
  const plotHeight = height - padTop - padBottom;
  const dense = points.length > 12;
  const coords = values.map((value, index) => {
    const x = padX + (index / (values.length - 1)) * (width - padX * 2);
    const ratio = max > 0n ? Number((value * 10_000n) / max) / 10_000 : 0;
    return { x, y: padTop + plotHeight * (1 - ratio) };
  });
  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const labelEvery = points.length <= 12 ? 1 : Math.ceil(points.length / 6);
  const granularityLabel =
    card.trend?.granularity === "day"
      ? "按日"
      : card.trend?.granularity === "week"
        ? "按周"
        : "按月";

  return (
    <div className="mt-4 rounded-[16px] bg-[var(--color-control-fill-muted)] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
          {TYPE_LABEL[type]}趋势
        </p>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {granularityLabel} · {displayUnitLabel}
        </span>
      </div>
      <div className="mt-2">
        <svg
          aria-label={`${TYPE_LABEL[type]}趋势折线图，每个时间点均标注具体金额`}
          className="h-[164px] w-full overflow-visible"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-separator, rgba(0,0,0,0.08))"
            x1={padX}
            x2={width - padX}
            y1={padTop + plotHeight}
            y2={padTop + plotHeight}
          />
          <path
            d={path}
            fill="none"
            stroke={TYPE_COLOR[type]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
          {coords.map((point, index) => (
            <g key={`${points[index]!.label}:${index}`}>
              <circle cx={point.x} cy={point.y} fill={TYPE_COLOR[type]} r="3.5">
                <title>{`${points[index]!.label}：${amount(values[index]!.toString(), currency)}`}</title>
              </circle>
              <text
                fill="var(--color-text-primary)"
                fontSize={dense ? "7" : "9"}
                fontWeight="600"
                textAnchor="middle"
                style={dense ? { writingMode: "vertical-rl" } : undefined}
                x={point.x}
                y={dense ? Math.max(3, point.y - 31) : Math.max(10, point.y - 8)}
              >
                {compactTrendValue(values[index]!, displayUnit)}
              </text>
              {index % labelEvery === 0 || index === points.length - 1 ? (
                <text
                  fill="var(--color-text-muted)"
                  fontSize="9"
                  textAnchor={
                    index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
                  }
                  x={point.x}
                  y={height - 7}
                >
                  {card.trend?.granularity === "month"
                    ? `${points[index]!.label.split("/").at(-1)}月`
                    : points[index]!.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/** 任意日期范围统计：收支总额 + 趋势折线图 + 分类饼图 + 一级分类汇总。 */
export function StatsPeriodCard({ card }: { card: Extract<AiCard, { kind: "stats_period" }> }) {
  const currency = useCardCurrency(card.currency);
  const hasExpense = card.expenseMicros !== "0";
  const hasIncome = card.incomeMicros !== "0";
  // 双边都有数据才展示差额、另一侧汇总与分类切换；单边时锁定到有数据的一侧。
  const bothSides = hasExpense && hasIncome;
  const [selectedType, setSelectedType] = useState<"expense" | "income">("expense");
  const type = bothSides ? selectedType : hasIncome && !hasExpense ? "income" : "expense";
  const categories = type === "expense" ? card.expenseCategories : card.incomeCategories;
  const totalMicros = type === "expense" ? card.expenseMicros : card.incomeMicros;
  return (
    <div className="ai-card">
      <p className="font-bold text-[var(--color-text-primary)]">{card.title}</p>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        {card.dateFrom} 至 {card.dateTo}
      </p>
      {bothSides ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-text-muted)]">总支出</p>
            <p
              className="truncate text-[16px] font-bold [font-variant-numeric:tabular-nums]"
              style={{ color: TYPE_COLOR.expense }}
            >
              {amount(card.expenseMicros, currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-text-muted)]">总收入</p>
            <p
              className="truncate text-[16px] font-bold [font-variant-numeric:tabular-nums]"
              style={{ color: TYPE_COLOR.income }}
            >
              {amount(card.incomeMicros, currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-text-muted)]">差额</p>
            <p className="truncate text-[16px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {amount(
                (BigInt(card.incomeMicros) - BigInt(card.expenseMicros)).toString(),
                currency,
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            {type === "expense" ? "总支出" : "总收入"}
          </p>
          <p
            className="text-[18px] font-bold [font-variant-numeric:tabular-nums]"
            style={{ color: TYPE_COLOR[type] }}
          >
            {amount(totalMicros, currency)}
          </p>
        </div>
      )}
      {bothSides ? (
        <Tabs
          className="mt-4"
          items={[
            { label: "支出", value: "expense" },
            { label: "收入", value: "income" },
          ]}
          onValueChange={(value) => setSelectedType(value as "expense" | "income")}
          value={type}
        />
      ) : null}
      <StatsTrendChart card={card} currency={currency} type={type} />
      {/* 单一分类时饼图是无信息量的整圆，隐藏，只留分类汇总。 */}
      {categories.length > 1 ? (
        <StatsCategoryDonut
          categories={categories}
          currency={currency}
          totalMicros={totalMicros}
          type={type}
        />
      ) : null}
      <CategorySummary
        categories={categories}
        currency={currency}
        totalMicros={totalMicros}
        type={type}
      />
    </div>
  );
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  savings: "储蓄",
  credit: "信用",
  invest: "投资",
  receivable: "可收回",
  payable: "需归还",
};

/** 账户余额卡：总资产/总负债/净资产 + 各账户余额（负债展示为负向红色）。 */
export function AccountBalancesCard({
  card,
}: {
  card: Extract<AiCard, { kind: "account_balances" }>;
}) {
  const currency = useCardCurrency(card.currency);
  return (
    <div className="ai-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-[var(--color-text-primary)]">{card.title}</p>
        <div className="text-right">
          <p className="text-[11px] text-[var(--color-text-muted)]">净资产</p>
          <p className="text-[18px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
            {amount(card.netWorthMicros, currency)}
          </p>
        </div>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-[var(--color-text-muted)]">
        <span>资产 {amount(card.totalAssetsMicros, currency)}</span>
        <span>负债 {amount(card.totalLiabilitiesMicros, currency)}</span>
      </div>
      {card.accounts.length > 0 ? (
        <div className="mt-3 flex flex-col divide-y divide-black/[0.04]">
          {card.accounts.map((account, index) => (
            <div className="flex items-center justify-between gap-3 py-2 text-sm" key={index}>
              <div className="min-w-0">
                <span className="truncate text-[var(--color-text-primary)]">{account.name}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                  {ACCOUNT_TYPE_LABEL[account.type] ?? account.type}
                </span>
              </div>
              <span
                className="shrink-0 font-semibold [font-variant-numeric:tabular-nums]"
                style={{
                  color: account.isLiability
                    ? "var(--color-accent-expense)"
                    : "var(--color-text-primary)",
                }}
              >
                {account.isLiability ? "-" : ""}
                {amount(account.balanceMicros, currency)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">暂无账户</p>
      )}
    </div>
  );
}

function BudgetBar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(percent, 100));
  const over = percent > 100;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
      <div
        className="h-full rounded-full"
        style={{
          width: `${width}%`,
          backgroundColor: over ? "var(--color-accent-expense)" : "var(--color-tint-strong)",
        }}
      />
    </div>
  );
}

/** 预算进度卡：总预算/已用/剩余 + 各分类进度条。 */
export function BudgetProgressCard({
  card,
}: {
  card: Extract<AiCard, { kind: "budget_progress" }>;
}) {
  const currency = useCardCurrency(card.currency);
  if (!card.enabled) {
    return (
      <div className="ai-card">
        <p className="font-bold text-[var(--color-text-primary)]">{card.month} 预算</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">该月未启用预算</p>
      </div>
    );
  }
  return (
    <div className="ai-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-[var(--color-text-primary)]">{card.month} 预算进度</p>
        <p className="shrink-0 text-xs text-[var(--color-text-muted)]">
          {card.percent.toFixed(0)}%
        </p>
      </div>
      <div className="mt-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-[var(--color-text-muted)]">已用</span>
          <span className="text-[var(--color-text-primary)]">
            {amount(card.usedMicros, currency)}
            {card.totalBudgetMicros ? ` / ${amount(card.totalBudgetMicros, currency)}` : ""}
          </span>
        </div>
        {card.totalBudgetMicros ? <BudgetBar percent={card.percent} /> : null}
        {card.remainingMicros ? (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            剩余 {amount(card.remainingMicros, currency)}
          </p>
        ) : null}
      </div>
      {card.categories.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {card.categories.map((item, index) => (
            <div key={index}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-[var(--color-text-primary)]">{item.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                  {amount(item.usedMicros, currency)}
                  {item.budgetMicros ? ` / ${amount(item.budgetMicros, currency)}` : ""}
                </span>
              </div>
              {item.budgetMicros ? <BudgetBar percent={item.percent} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
