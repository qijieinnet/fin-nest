"use client";

import { CurrencySelect } from "@/components/business";
import type { FxQuote } from "@/lib/api";
import { currencyLabel } from "@/lib/data/currency-names";
import { cleanMoneyInput } from "@/lib/money";
import { t } from "@/lib/i18n";
import type { TransactionFxModel } from "./_model/useTransactionFx";

function rateHint(quote: FxQuote | null, loading: boolean, from: string): string {
  if (quote) {
    const source = quote.source === "manual" ? t("手填") : t("欧洲央行");
    return t("1 {from} = {rate} {to} · {date} · {source}", {
      from,
      rate: quote.rate,
      to: quote.to,
      date: quote.date,
      source,
    });
  }
  if (loading) return t("正在取汇率…");
  return t("取不到汇率，请直接填写实际金额（也可以去「更多 › 汇率」补录）");
}

function FxAmountRow({
  decimalPlaces,
  hint,
  label,
  onChange,
  onFocus,
  value,
}: {
  decimalPlaces: number;
  hint: string;
  label: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  value: string;
}) {
  return (
    <label className="flex flex-col gap-1 px-4 py-3">
      <span className="flex items-center gap-3">
        <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">{label}</span>
        {/* 标签里已写明币种（「折合 人民币 CNY」），这里不再挂一个和数字隔开的符号。 */}
        <span className="text-[17px] font-semibold text-[var(--color-text-primary)]">
          <input
            aria-label={label}
            className="w-32 bg-transparent text-right outline-none [font-variant-numeric:tabular-nums] placeholder:text-[var(--color-text-muted)]"
            inputMode="decimal"
            onChange={(event) => onChange(cleanMoneyInput(event.target.value))}
            onFocus={onFocus}
            placeholder={decimalPlaces > 0 ? `0.${"0".repeat(decimalPlaces)}` : "0"}
            value={value}
          />
        </span>
      </span>
      <span className="text-[12px] leading-4 text-[var(--color-text-muted)]">{hint}</span>
    </label>
  );
}

/** 金额前的币种切换：本币置顶；转账 / 外币账户限定可选项，只剩一个时就是不可点的符号。 */
export function EntryCurrencySelect({ fx }: { fx: TransactionFxModel }) {
  return (
    <CurrencySelect
      align="start"
      onChange={fx.setEntryCurrency}
      options={fx.currencyOptions}
      pinned={fx.baseCurrency}
      value={fx.entryCurrency}
      variant="symbol"
    />
  );
}

/**
 * 记账表单的外币区：（需要时）折合本币 / 另一侧金额。
 * 入账币种本身在金额前的符号上切换（EntryCurrencySelect）；全是本币时这里什么都不渲染。
 */
export function TransactionFxFields({
  fx,
  onInputFocus,
}: {
  fx: TransactionFxModel;
  /** 移动端：聚焦这些系统键盘输入框前先收起自绘金额键盘。 */
  onInputFocus?: () => void;
}) {
  if (!fx.showBase && !fx.sideCurrency) return null;
  return (
    <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      {fx.showBase ? (
        <>
          <FxAmountRow
            decimalPlaces={fx.ledgerDecimalPlaces}
            hint={rateHint(fx.baseQuote, fx.baseRateLoading, fx.entryCurrency)}
            label={t("折合 {currency}", { currency: currencyLabel(fx.baseCurrency) })}
            onChange={fx.setBaseAmount}
            onFocus={onInputFocus}
            value={fx.baseAmount}
          />
        </>
      ) : null}
      {fx.sideCurrency ? (
        <>
          {fx.showBase ? <span className="transaction-form__divider" /> : null}
          <FxAmountRow
            decimalPlaces={fx.sideDecimalPlaces}
            hint={rateHint(fx.sideQuote, false, fx.entryCurrency)}
            label={`${fx.sideLabel}（${fx.sideCurrency}）`}
            onChange={fx.setSideAmount}
            onFocus={onInputFocus}
            value={fx.sideAmount}
          />
        </>
      ) : null}
    </div>
  );
}
