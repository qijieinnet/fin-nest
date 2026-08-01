"use client";

import { Check, LoaderCircle, Zap } from "lucide-react";
import { cn } from "@/lib/format/class-names";

type TransactionFormFabProps = {
  /** 满足提交条件（与右上角保存按钮同一判断）时，按钮切换为提交态。 */
  canSubmit: boolean;
  /** 数据未就绪 / 保存中：按钮不可点。 */
  disabled?: boolean;
  /** 目标表单 id，提交态用它触发与右上角一致的提交。 */
  formId: string;
  loading?: boolean;
  /** 提供时，未满足提交条件的按钮为「快捷记账」；不提供则显示未激活的提交按钮。 */
  onQuickClick?: () => void;
  /** 未满足提交条件时点击提交按钮的提示回调（与右上角保存一致）。 */
  onSubmitBlocked?: () => void;
  submitLabel?: string;
};

/** 移动端记账/编辑页右下角悬浮按钮：条件未满足时是快捷记账，满足后变成提交。 */
export function TransactionFormFab({
  canSubmit,
  disabled = false,
  formId,
  loading = false,
  onQuickClick,
  onSubmitBlocked,
  submitLabel = "保存",
}: TransactionFormFabProps) {
  const quickMode = !canSubmit && Boolean(onQuickClick);
  const label = quickMode ? "快捷记账" : submitLabel;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
      <div className="relative w-[min(100vw,430px)]">
        <button
          aria-disabled={!quickMode && !canSubmit ? true : undefined}
          aria-label={label}
          className={cn(
            "pointer-events-auto absolute bottom-[calc(34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] shadow-[var(--shadow-app)] transition-colors",
            quickMode
              ? "border border-white/50 bg-[rgba(255,255,255,0.62)] text-[var(--color-text-primary)] backdrop-blur-xl"
              : canSubmit
                ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
                : "bg-[var(--color-control-fill-muted)] text-[var(--color-disabled-text)]",
          )}
          disabled={disabled || loading}
          // 提交态借用 form 属性触发表单提交，与右上角保存按钮同一条链路。
          form={quickMode ? undefined : formId}
          onClick={(event) => {
            if (quickMode) {
              onQuickClick?.();
              return;
            }
            if (!canSubmit) {
              event.preventDefault();
              onSubmitBlocked?.();
            }
          }}
          title={label}
          type={quickMode ? "button" : "submit"}
        >
          {loading ? (
            <LoaderCircle className="ui-button__spinner" size={20} />
          ) : quickMode ? (
            <Zap size={20} />
          ) : (
            <Check size={22} strokeWidth={2.6} />
          )}
        </button>
      </div>
    </div>
  );
}
