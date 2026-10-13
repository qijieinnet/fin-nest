"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { CurrencySelect } from "@/components/business";
import { IconButton, EmojiPicker } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import {
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type Ledger,
  ledgerPath,
} from "@/lib/api";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { t } from "@/lib/i18n";

const DEFAULT_ICON = "📒";

/** 金额小数位数可选项（后端允许 0–6，这里给常用范围）。 */
const DECIMAL_OPTIONS = [0, 1, 2, 3, 4];
const DEFAULT_DECIMALS = 2;

type CreateLedgerSheetProps = {
  ledger?: Ledger;
};

export function CreateLedgerSheet({ ledger }: CreateLedgerSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const { setLedgerId } = useLedger();
  const isEditing = Boolean(ledger);
  const [name, setName] = useState(ledger?.name ?? "");
  const [icon, setIcon] = useState(ledger?.icon?.trim() || DEFAULT_ICON);
  const [decimals, setDecimals] = useState(ledger?.amountDecimalPlaces ?? DEFAULT_DECIMALS);
  const [currency, setCurrency] = useState(ledger?.currency ?? DEFAULT_CURRENCY);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const mutation = useMutation({
    // 错误已在表单内联展示，跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () => {
      // 本币没改就不传：后端对「有数据后改本币」直接拒绝，没改的字段不该触发这道校验。
      const body = {
        name: name.trim(),
        icon,
        amountDecimalPlaces: decimals,
        ...(!ledger || currency !== ledger.currency ? { currency } : {}),
      };
      if (ledger) {
        return apiRequest<Ledger>(ledgerPath(ledger.id), {
          method: "PATCH",
          body,
        });
      }
      return apiRequest<Ledger>(API_ENDPOINTS.ledgers, {
        method: "POST",
        body,
      });
    },
    onSuccess: async (savedLedger) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      if (!isEditing) {
        setLedgerId(savedLedger.id);
      }
      showToast({
        tone: "success",
        message: isEditing ? t("账本已更新") : t("已创建「{name}」", { name: savedLedger.name }),
      });
      pop();
    },
  });

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    !mutation.isPending &&
    (!ledger ||
      trimmedName !== ledger.name ||
      icon !== (ledger.icon?.trim() || DEFAULT_ICON) ||
      decimals !== (ledger.amountDecimalPlaces ?? DEFAULT_DECIMALS) ||
      currency !== ledger.currency);

  const submit = () => {
    if (canSubmit) mutation.mutate();
  };

  return (
    <>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
          <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
          <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
            {isEditing ? t("编辑账本") : t("新建账本")}
          </h2>
          <IconButton
            disabled={!canSubmit}
            icon={<Check size={24} strokeWidth={2.6} />}
            label={isEditing ? t("保存账本") : t("创建账本")}
            loading={mutation.isPending}
            onClick={submit}
            variant="primary"
          />
        </div>

        <div className="flex items-center gap-3.5">
          <button
            aria-label={t("选择账本图标")}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-bg-surface)] text-[26px] leading-none shadow-[var(--shadow-soft)]"
            onClick={() => setEmojiPickerOpen(true)}
            type="button"
          >
            {icon}
          </button>
          <input
            autoFocus
            className="ledger-sheet__name-input h-12 min-w-0 flex-1 rounded-[13px] border-0 bg-[var(--color-bg-surface)] px-4 text-[17px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)] outline-none placeholder:text-[var(--color-text-muted)]"
            name="name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("账本名称，如：旅行基金")}
            value={name}
          />
        </div>

        <div className="flex items-center gap-3 rounded-[13px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]">
          <span className="flex-1 text-[15px] font-medium text-[var(--color-text-primary)]">
            {t("金额小数位数")}
          </span>
          <div className="flex items-center gap-1 rounded-full bg-[var(--color-control-fill-muted)] p-1">
            {DECIMAL_OPTIONS.map((value) => {
              const selected = decimals === value;
              return (
                <button
                  aria-label={t("{value} 位小数", { value })}
                  aria-pressed={selected}
                  className={cn(
                    "h-8 w-9 rounded-full text-[15px] font-medium transition-colors",
                    selected
                      ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
                      : "text-[var(--color-text-secondary)]",
                  )}
                  key={value}
                  onClick={() => setDecimals(value)}
                  type="button"
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3 rounded-[13px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]">
            <span className="flex-1 text-[15px] font-medium text-[var(--color-text-primary)]">
              {t("本币")}
            </span>
            <CurrencySelect
              onChange={setCurrency}
              pinned={DEFAULT_CURRENCY}
              value={currency}
              variant="row"
            />
          </div>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {t("统计、预算和净资产都按本币计；外币可以在账户和记账时单独选。账本里有账户或记账数据后本币不能再改。")}
          </p>
        </div>

        {mutation.isError ? (
          <p className="text-sm text-[var(--color-accent-expense)]">
            {getApiErrorMessage(
              mutation.error,
              isEditing ? t("保存失败，请稍后重试") : t("创建失败，请稍后重试"),
            )}
          </p>
        ) : null}
        {!isEditing ? (
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            {t("新账本会自动初始化默认记账设置、人员「我」和基础收支分类。")}
          </p>
        ) : null}
      </div>

      <EmojiPicker
        onClose={() => setEmojiPickerOpen(false)}
        onSelect={setIcon}
        open={emojiPickerOpen}
        title={t("选择账本图标")}
        value={icon}
      />
    </>
  );
}
