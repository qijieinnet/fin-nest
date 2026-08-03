"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { DateWheelPicker } from "@/components/business";
import { IconButton } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type ItemAsset } from "@/lib/api";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { todayKey } from "./item-utils";

type ItemScrapSheetProps = {
  item: ItemAsset;
  ledgerId: string;
};

/** 记一笔风格的整卡输入行：标签在左，输入右对齐。 */
function FieldRow({
  inputMode,
  label,
  onChange,
  placeholder,
  prefix,
  value,
}: {
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  prefix?: string;
  value: string;
}) {
  return (
    <label className="account-form__field-row">
      <span>{label}</span>
      <span className="account-form__input-wrap">
        {prefix ? <span className="account-form__prefix">{prefix}</span> : null}
        <input
          className="account-form__input"
          inputMode={inputMode}
          onChange={onChange}
          placeholder={placeholder}
          value={value}
        />
      </span>
    </label>
  );
}

function DateFieldRow({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="transaction-form__date-card">
      <DateWheelPicker label={label} onValueChange={onChange} value={value} />
    </div>
  );
}

export function ItemScrapSheet({ item, ledgerId }: ItemScrapSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const [scrapDate, setScrapDate] = useState(todayKey());
  const [sellPrice, setSellPrice] = useState("");

  const scrap = useMutation({
    mutationFn: async () => {
      const priceParsed = sellPrice.trim() ? parseMoneyToMicros(sellPrice, { decimalPlaces }) : null;
      if (priceParsed && !priceParsed.ok) throw new Error("出售价格格式不正确");
      return apiRequest(ledgerApiPath(ledgerId, `/items/${item.id}/scrap`), {
        method: "POST",
        body: {
          scrapDate,
          sellPriceMicros: priceParsed?.amountMicros,
        },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.item(ledgerId, item.id) }),
      ]);
      showToast({ tone: "success", message: "已标记报废 / 出售" });
      pop();
    },
  });

  return (
    <form
      className="transaction-form flex min-h-0 flex-1 flex-col !gap-0 !pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (!scrap.isPending) scrap.mutate();
      }}
    >
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-2">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          报废或出售
        </h2>
        <IconButton
          disabled={scrap.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="确定报废或出售"
          loading={scrap.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="sheet-form-scroll flex-1 pb-6">
        <div className="transaction-form__cards">
          <p className="px-1 text-[13px] leading-5 text-[var(--color-text-muted)]">
            填写报废 / 出售日期，「{item.name}」的使用时长将统计到该日为止，出售价格选填。
          </p>

          <div className="transaction-form__card">
            <DateFieldRow label="报废日期" onChange={setScrapDate} value={scrapDate} />
            <span className="transaction-form__divider" />
            <FieldRow
              inputMode="decimal"
              label="出售价格"
              onChange={(event) => setSellPrice(event.target.value)}
              placeholder="选填"
              prefix="¥"
              value={sellPrice}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
