"use client";

import { CurrencySelect } from "@/components/business";
import type { FxQuote } from "@/lib/api";
import { currencyLabel } from "@/lib/data/currency-names";
import { cleanMoneyInput, currencySymbolOf } from "@/lib/money";
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
  currency,
  decimalPlaces,
  hint,
  label,
  onChange,
  onFocus,
  value,
}: {
  currency: string;
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
        <span className="flex items-baseline gap-1 text-[17px] font-semibold text-[var(--color-text-primary)]">
          <span className="text-[14px] text-[var(--color-text-secondary)]">
            {currencySymbolOf(currency)}
          </span>
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

/**
 * 记账表单的币种区：入账币种 + （需要时）折合本币 / 另一侧金额。
 * 全是本币时只有一行不起眼的「币种」，不打扰只记本币的人。
 */
export function TransactionFxFields({
  fx,
  onInputFocus,
}: {
  fx: TransactionFxModel;
  /** 移动端：聚焦这些系统键盘输入框前先收起自绘金额键盘。 */
  onInputFocus?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">{t("币种")}</span>
        <CurrencySelect
          onChange={fx.setEntryCurrency}
          options={fx.currencyOptions}
          pinned={fx.baseCurrency}
          value={fx.entryCurrency}
          variant="row"
        />
      </div>
      {fx.showBase ? (
        <>
          <span className="transaction-form__divider" />
          <FxAmountRow
            currency={fx.baseCurrency}
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
          <span className="transaction-form__divider" />
          <FxAmountRow
            currency={fx.sideCurrency}
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
