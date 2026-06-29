"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { ActionButton, EmojiPicker } from "@/components/ui";
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

/** 原型新建账本快捷图标。 */
const LEDGER_ICON_PRESETS = ["📒", "🏠", "✈️", "🛋️", "💼", "🎓", "🍽️", "🚗", "🎁", "💍", "🐱", "⚽"];

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
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), icon };
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
    (!ledger || trimmedName !== ledger.name || icon !== (ledger.icon?.trim() || DEFAULT_ICON));

  const submit = () => {
    if (canSubmit) mutation.mutate();
  };

  return (
    <>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
          <ActionButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
          <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
            {isEditing ? "编辑账本" : "新建账本"}
          </h2>
          <ActionButton
            disabled={!canSubmit}
            icon={<Check size={24} strokeWidth={2.6} />}
            label={isEditing ? "保存账本" : "创建账本"}
            onClick={submit}
            tone="primary"
          />
        </div>

        <div className="flex items-center gap-3.5">
          <button
            aria-label="选择账本图标"
            className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-2xl bg-[var(--color-bg-surface)] text-[30px] leading-none shadow-[var(--shadow-soft)]"
            onClick={() => setEmojiPickerOpen(true)}
            type="button"
          >
            {icon}
          </button>
          <input
            autoFocus
            className="h-12 min-w-0 flex-1 rounded-[13px] border-0 bg-[var(--color-bg-surface)] px-4 text-[17px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:shadow-[var(--shadow-soft)]"
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

        <div className="grid grid-cols-6 gap-2 px-0.5">
          {LEDGER_ICON_PRESETS.map((preset) => (
            <button
              aria-label={`选择图标 ${preset}`}
              className={cn(
                "flex h-[46px] items-center justify-center rounded-xl text-[23px] leading-none transition-colors",
                icon === preset
                  ? "bg-[var(--color-tint-soft)]"
                  : "bg-[var(--color-control-fill-muted)] active:bg-[var(--color-control-pressed)]",
              )}
              key={preset}
              onClick={() => setIcon(preset)}
              type="button"
            >
              {preset}
            </button>
          ))}
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
