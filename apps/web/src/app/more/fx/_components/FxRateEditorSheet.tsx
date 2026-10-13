"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { CurrencySelect, DateWheelPicker } from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath } from "@/lib/api";
import { CURRENCIES } from "@/lib/money";
import { FX_RATE_PATTERN } from "@fin-nest/shared";
import { useBaseCurrency, useSheetStack, useToast } from "@/providers";
import { t } from "@/lib/i18n";
import { todayKey } from "../../../bills/_components/_model/transaction-form-utils";

type FxRateEditorSheetProps = {
  ledgerId: string;
  /** 预选的外币（从「缺汇率」的那一行点进来时）。 */
  currency?: string;
  /** 预填的汇率与日期（修改已有手填记录时）。 */
  rate?: string;
  date?: string;
};

/** 手填 / 覆盖某天的汇率：1 外币 = rate 本币。同一天已有手填记录时覆盖。 */
export function FxRateEditorSheet({ currency, date, ledgerId, rate }: FxRateEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const { code: baseCurrency, symbol: baseSymbol } = useBaseCurrency();
  const foreign = CURRENCIES.map((item) => item.code).filter((code) => code !== baseCurrency);
  const [selected, setSelected] = useState(currency ?? foreign[0] ?? "USD");
  const [rateDate, setRateDate] = useState(date ?? todayKey());
  const [rateText, setRateText] = useState(rate ?? "");

  const trimmed = rateText.trim();
  const valid = FX_RATE_PATTERN.test(trimmed) && Number(trimmed) > 0;

  const save = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId, "/fx/rates"), {
        method: "PUT",
        body: { currency: selected, date: rateDate, rate: trimmed },
      }),
    onSuccess: async () => {
      // 汇率一变，账户折合余额、净资产、记账表单里的折算都要重算。
      await queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId] });
      showToast({ tone: "success", message: t("汇率已保存") });
      pop();
    },
  });

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {t("手填汇率")}
        </h2>
        <IconButton
          disabled={!valid || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={t("保存汇率")}
          loading={save.isPending}
          onClick={() => save.mutate()}
          variant="primary"
        />
      </div>

      <div className="flex items-center gap-3 rounded-[13px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]">
        <span className="flex-1 text-[15px] font-medium text-[var(--color-text-primary)]">
          {t("外币")}
        </span>
        <CurrencySelect onChange={setSelected} options={foreign} value={selected} variant="row" />
      </div>

      <div className="rounded-[13px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          autoFocus
          inputMode="decimal"
          label={t("1 {currency} 折合多少 {base}", { currency: selected, base: baseCurrency })}
          onChange={(event) => setRateText(event.target.value)}
          placeholder="7.1234"
          prefix={baseSymbol}
          value={rateText}
        />
      </div>

      <div className="transaction-form__card transaction-form__date-card">
        <DateWheelPicker label={t("汇率日期")} onValueChange={setRateDate} value={rateDate} />
      </div>

      <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
        {t("记账按交易日当天或之前最近一天的汇率折算；同一天手填的优先于自动获取的。")}
      </p>
      {save.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(save.error, t("保存失败，请稍后重试"))}
        </p>
      ) : null}
    </div>
  );
}
