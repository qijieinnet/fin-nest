"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { IconButton, EmojiPicker } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import {
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type Ledger,
  ledgerPath,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useSheetStack, useToast } from "@/providers";

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
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const mutation = useMutation({
    // 错误已在表单内联展示，跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () => {
      const body = { name: name.trim(), icon, amountDecimalPlaces: decimals };
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
        message: isEditing ? "账本已更新" : `已创建「${savedLedger.name}」`,
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
      decimals !== (ledger.amountDecimalPlaces ?? DEFAULT_DECIMALS));

  const submit = () => {
    if (canSubmit) mutation.mutate();
  };

  return (
    <>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
          <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
          <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
            {isEditing ? "编辑账本" : "新建账本"}
          </h2>
          <IconButton
            disabled={!canSubmit}
            icon={<Check size={24} strokeWidth={2.6} />}
            label={isEditing ? "保存账本" : "创建账本"}
            loading={mutation.isPending}
            onClick={submit}
            variant="primary"
          />
        </div>

        <div className="flex items-center gap-3.5">
          <button
            aria-label="选择账本图标"
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
            placeholder="账本名称，如：旅行基金"
            value={name}
          />
        </div>

        <div className="flex items-center gap-3 rounded-[13px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]">
          <span className="flex-1 text-[15px] font-medium text-[var(--color-text-primary)]">
            金额小数位数
          </span>
          <div className="flex items-center gap-1 rounded-full bg-[var(--color-control-fill-muted)] p-1">
            {DECIMAL_OPTIONS.map((value) => {
              const selected = decimals === value;
              return (
                <button
                  aria-label={`${value} 位小数`}
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

        {mutation.isError ? (
          <p className="text-sm text-[var(--color-accent-expense)]">
            {getApiErrorMessage(
              mutation.error,
              isEditing ? "保存失败，请稍后重试" : "创建失败，请稍后重试",
            )}
          </p>
        ) : null}
        {!isEditing ? (
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            新账本会自动初始化默认记账设置、人员「我」和基础收支分类。
          </p>
        ) : null}
      </div>

      <EmojiPicker
        onClose={() => setEmojiPickerOpen(false)}
        onSelect={setIcon}
        open={emojiPickerOpen}
        title="选择账本图标"
        value={icon}
      />
    </>
  );
}
