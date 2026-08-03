"use client";

import { useEffect } from "react";
import { LoadingState } from "@/components/business";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { useSheetStack } from "@/providers";
import { ItemEditorSheet } from "../../more/items/_components/ItemEditorSheet";
import { TransactionFormDesktop } from "./TransactionForm.desktop";
import { TransactionFormMobile } from "./TransactionForm.mobile";
import {
  type TransactionSeed,
  type UseTransactionFormModelParams,
  useTransactionFormModel,
} from "./_model/useTransactionFormModel";

export type { TransactionSeed };

type TransactionFormProps = UseTransactionFormModelParams & {
  formId?: string;
  /** 移动端金额键盘的展开态，由页面壳持有（FAB 要据此让位）。 */
  keypadOpen?: boolean;
  onKeypadOpenChange?: (open: boolean) => void;
  onKeypadAutoOpen?: (enabled: boolean) => void;
  onQuickTemplates?: () => void;
};

/**
 * 交易表单调度层：调用共享视图模型（A1）+ 承载含 JSX 的「新建物品」弹层动作，
 * 按断点分发到移动 / 桌面渲染层（B5）。移动端行为与改造前一致。
 */
export function TransactionForm({
  formId,
  keypadOpen,
  onKeypadAutoOpen,
  onKeypadOpenChange,
  onQuickTemplates,
  ...modelParams
}: TransactionFormProps) {
  const { push } = useSheetStack();
  const isDesktop = useIsDesktop();
  const model = useTransactionFormModel(modelParams);

  // 记账设置要等接口回来才知道，把它回传给页面壳决定是否首次自动展开键盘。
  useEffect(() => {
    if (!model.isLoading) onKeypadAutoOpen?.(model.keypadAutoOpen);
  }, [model.isLoading, model.keypadAutoOpen, onKeypadAutoOpen]);

  function openCreateItemSheet() {
    model.setItemEnabled(true);
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <ItemEditorSheet ledgerId={model.ledgerId} onSaved={model.applyCreatedItem} />,
    });
  }

  if (model.isLoading) {
    return <LoadingState rows={5} title="加载记账设置" />;
  }

  return isDesktop ? (
    <TransactionFormDesktop formId={formId} model={model} openCreateItemSheet={openCreateItemSheet} />
  ) : (
    <TransactionFormMobile
      formId={formId}
      keypadOpen={keypadOpen}
      model={model}
      onKeypadOpenChange={onKeypadOpenChange}
      onQuickTemplates={onQuickTemplates}
      openCreateItemSheet={openCreateItemSheet}
    />
  );
}
