"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { PopoverMenu } from "@/components/ui";
import { CURRENCY_NAMES } from "@/lib/data/currency-names";
import { cn } from "@/lib/format/class-names";
import { CURRENCIES, currencySymbolOf } from "@/lib/money";
import { t } from "@/lib/i18n";

type CurrencySelectProps = {
  value: string;
  onChange: (currency: string) => void;
  /** 排在最前面的币种（通常是账本本币），单独一组。 */
  pinned?: string;
  /** 只允许选这些（如外币账户只能记账户币种或本币）；不传 = 目录里全部。 */
  options?: string[];
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
  /**
   * - row：完整名称（建账本 / 汇率这类「币种本身就是主角」的表单行）；
   * - pill：代码小胶囊；
   * - symbol：只显示符号 + 小箭头，嵌在金额输入框前面，字号颜色跟随外层（金额前缀）。
   */
  variant?: "pill" | "row" | "symbol";
};

/**
 * 币种选择：iOS 风格的 PopoverMenu（规范 9），本币单独置顶一组。
 * 只有一个可选项时退化成不可点的标签——外币账户的记账币种就是这种情况。
 */
export function CurrencySelect({
  align = "end",
  className,
  disabled,
  onChange,
  options,
  pinned,
  value,
  variant = "pill",
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const codes = options ?? CURRENCIES.map((currency) => currency.code);
  const locked = disabled || codes.length <= 1;
  const item = (code: string) => ({
    label: `${code} ${currencySymbolOf(code).trim()}`,
    description: CURRENCY_NAMES[code],
    selected: code === value,
    onSelect: () => onChange(code),
  });
  const groups =
    pinned && codes.includes(pinned)
      ? [[item(pinned)], codes.filter((code) => code !== pinned).map(item)]
      : [codes.map(item)];

  return (
    <div className={cn("relative", className)}>
      <button
        aria-label={t("选择币种")}
        className={cn(
          variant === "pill"
            ? "flex items-center gap-0.5 rounded-full bg-[var(--color-control-fill-muted)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--color-text-secondary)]"
            : variant === "symbol"
              ? "flex items-center gap-[0.12em] bg-transparent p-0 [font:inherit] [color:inherit]"
              : "flex items-center gap-1 text-[15px] text-[var(--color-text-secondary)]",
          locked && "cursor-default",
        )}
        disabled={locked}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {variant === "symbol"
          ? currencySymbolOf(value).trim()
          : variant === "row" && CURRENCY_NAMES[value]
            ? `${CURRENCY_NAMES[value]} ${value}`
            : value}
        {locked ? null : (
          <ChevronDown
            className="shrink-0 text-[var(--color-text-muted)]"
            size={variant === "symbol" ? "0.55em" : 13}
            strokeWidth={variant === "symbol" ? 2.6 : 2}
          />
        )}
      </button>
      <PopoverMenu align={align} groups={groups} onOpenChange={setOpen} open={open} />
    </div>
  );
}
