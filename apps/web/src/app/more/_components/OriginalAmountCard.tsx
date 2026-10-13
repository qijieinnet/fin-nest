"use client";

import { useEffect, useRef, useState } from "react";
import { convertMicros, parseFxRate } from "@fin-nest/shared";
import { CurrencySelect } from "@/components/business";
import { useFxRate } from "@/lib/data/fx";
import {
  cleanMoneyInput,
  currencyDecimals,
  currencySymbolOf,
  microsToInput,
  parseMoneyToMicros,
} from "@/lib/money";
import { useBaseCurrency, useDecimalPlaces } from "@/providers";
import { t } from "@/lib/i18n";
import { todayKey } from "../../bills/_components/_model/transaction-form-utils";

/**
 * 自动记账规则 / 快捷模板的「外币」部分：选币种 + 填原币金额。
 * 规则与模板里的本币金额只是估算，生成待确认 / 直接记账时后端会按当天汇率重算；
 * 这里按今天的汇率把估算值顺手填好（用户改过本币金额后就不再覆盖）。
 */
export function useOriginalAmount({
  initialCurrency,
  initialMicros,
  ledgerId,
  baseValue,
  onSuggestBase,
}: {
  initialCurrency: string | null | undefined;
  initialMicros: string | null | undefined;
  ledgerId: string;
  /** 编辑器里当前的本币估算（字符串）：用户手填过就不再自动覆盖。 */
  baseValue: string;
  /** 原币或币种变化后给出本币估算（input 字符串）。 */
  onSuggestBase: (value: string) => void;
}) {
  const { code: baseCurrency } = useBaseCurrency();
  const ledgerDecimalPlaces = useDecimalPlaces();
  const [currency, setCurrency] = useState(initialCurrency ?? baseCurrency);
  const [amount, setAmount] = useState(() =>
    initialCurrency
      ? microsToInput(initialMicros, { decimalPlaces: currencyDecimals(initialCurrency) })
      : "",
  );
  const foreign = currency !== baseCurrency;
  const decimalPlaces = currencyDecimals(currency);
  const rateQuery = useFxRate(ledgerId, foreign ? currency : null, baseCurrency, todayKey());

  const parsed = parseMoneyToMicros(amount, { decimalPlaces });
  const micros = parsed.ok && parsed.amountMicros ? BigInt(parsed.amountMicros) : null;
  const rate = rateQuery.data ? parseFxRate(rateQuery.data.rate) : null;
  const suggestion =
    foreign && micros !== null && micros > 0n && rate
      ? microsToInput(convertMicros(micros, rate), { decimalPlaces: ledgerDecimalPlaces })
      : null;
  // 只在用户改了原币 / 币种之后才给估算，打开已有规则时不覆盖它存着的本币金额；
  // 且本币框必须还是「上次自动填的值」或「改原币那一刻的值」——用户在汇率返回前手填了
  // 本币估算（照账单填的兜底值），迟到的汇率不能把它冲掉。
  const interacted = useRef(false);
  const lastSuggested = useRef<string | null>(null);
  const baseAtInteraction = useRef<string | null>(null);
  useEffect(() => {
    if (!interacted.current || !suggestion) return;
    const untouched =
      baseValue === lastSuggested.current || baseValue === baseAtInteraction.current;
    if (!untouched) return;
    lastSuggested.current = suggestion;
    baseAtInteraction.current = suggestion;
    onSuggestBase(suggestion);
  }, [suggestion]);
  const markInteraction = () => {
    // 用户改原币 / 币种：本币框若还是上次自动填的值，就允许按新原币重新估算。
    if (!interacted.current || baseValue === lastSuggested.current) {
      baseAtInteraction.current = baseValue;
    }
    interacted.current = true;
  };

  return {
    baseCurrency,
    currency,
    setCurrency: (value: string) => {
      markInteraction();
      setCurrency(value);
    },
    amount,
    setAmount: (value: string) => {
      markInteraction();
      setAmount(cleanMoneyInput(value));
    },
    foreign,
    decimalPlaces,
    rateText: rateQuery.data
      ? t("今日汇率 1 {currency} = {rate} {base}", {
          currency,
          rate: rateQuery.data.rate,
          base: baseCurrency,
        })
      : foreign && !rateQuery.isFetching
        ? t("取不到 {currency} 汇率：本币金额请手填，记账时也会沿用它", { currency })
        : "",
    /** 提交用：本币时两项都是 null（清除）；外币时必须有正的原币金额。 */
    payload():
      | { ok: true; originalCurrency: string | null; originalAmountMicros: string | null }
      | { ok: false; message: string } {
      if (!foreign) return { ok: true, originalCurrency: null, originalAmountMicros: null };
      if (micros === null || micros <= 0n) {
        return { ok: false, message: t("请填写 {currency} 金额", { currency }) };
      }
      return { ok: true, originalCurrency: currency, originalAmountMicros: micros.toString() };
    },
  };
}

export type OriginalAmountState = ReturnType<typeof useOriginalAmount>;

export function OriginalAmountCard({ state }: { state: OriginalAmountState }) {
  return (
    <div className="transaction-form__card">
      <div className="account-form__select-row">
        <span>{t("币种")}</span>
        <CurrencySelect
          onChange={state.setCurrency}
          pinned={state.baseCurrency}
          value={state.currency}
          variant="row"
        />
      </div>
      {state.foreign ? (
        <>
          <span className="transaction-form__divider" />
          <label className="account-form__field-row">
            <span>{t("原币金额")}</span>
            <span className="account-form__input-wrap">
              <span className="account-form__prefix">{currencySymbolOf(state.currency)}</span>
              <input
                className="account-form__input"
                inputMode="decimal"
                onChange={(event) => state.setAmount(event.target.value)}
                placeholder={state.decimalPlaces > 0 ? "0.00" : "0"}
                value={state.amount}
              />
            </span>
          </label>
          <p className="px-4 pb-3 text-[12px] leading-4 text-[var(--color-text-muted)]">
            {t("上方金额是本币估算；每次记账按当天汇率重算。")}
            {state.rateText ? ` ${state.rateText}` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
