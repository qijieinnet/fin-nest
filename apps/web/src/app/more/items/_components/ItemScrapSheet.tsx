"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { DateWheelPicker } from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type ItemAsset } from "@/lib/api";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { todayKey } from "./item-utils";

type ItemScrapSheetProps = {
  item: ItemAsset;
  ledgerId: string;
};

export function ItemScrapSheet({ item, ledgerId }: ItemScrapSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [scrapDate, setScrapDate] = useState(todayKey());
  const [sellPrice, setSellPrice] = useState("");

  const scrap = useMutation({
    mutationFn: async () => {
      const priceParsed = sellPrice.trim() ? parseMoneyToMicros(sellPrice) : null;
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
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") });
    },
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!scrap.isPending) scrap.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">报废或出售</h2>
        <IconButton
          disabled={scrap.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="确定报废或出售"
          variant="primary"
          type="submit"
        />
      </div>

      <p className="px-1 text-[13px] leading-5 text-[var(--color-text-muted)]">
        填写报废 / 出售日期，「{item.name}」的使用时长将统计到该日为止，出售价格选填。
      </p>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <DateWheelPicker label="报废日期" onValueChange={setScrapDate} value={scrapDate} />
        <Input
          inputMode="decimal"
          label="出售价格（选填）"
          onChange={(event) => setSellPrice(event.target.value)}
          placeholder="0"
          prefix="¥"
          value={sellPrice}
        />
      </div>
    </form>
  );
}
