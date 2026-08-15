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
  /** 只渲染金额键盘：账单列表的快捷记账没有表单页，字段全在键盘页签里改。 */
  keypadOnly?: boolean;
  /** 移动端金额键盘的展开态，由页面壳持有（FAB 要据此让位）。 */
  keypadOpen?: boolean;
  /** 键盘里保存按钮的文案，跟随页面壳（待确认编辑页是「确认入账」）。 */
  keypadSubmitLabel?: string;
  /** 键盘里「转到记账页」：带上当前已填内容跳全屏表单。给了才显示那个按钮。 */
  onExpand?: (seed: TransactionSeed) => void;
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
  keypadOnly = false,
  keypadOpen,
  keypadSubmitLabel,
  onExpand,
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
    // 只渲染键盘时不能占页面：加载骨架会凭空插进账单列表里。
    return keypadOnly ? null : <LoadingState rows={5} title="加载记账设置" />;
  }

  // 只有键盘的形态没有桌面版（桌面「记一笔」是弹层里的完整表单），不走断点分发。
  return isDesktop && !keypadOnly ? (
    <TransactionFormDesktop formId={formId} model={model} openCreateItemSheet={openCreateItemSheet} />
  ) : (
    <TransactionFormMobile
      formId={formId}
      keypadOnly={keypadOnly}
      keypadOpen={keypadOpen}
      keypadSubmitLabel={keypadSubmitLabel}
      model={model}
      onExpand={onExpand}
      onKeypadOpenChange={onKeypadOpenChange}
      onQuickTemplates={onQuickTemplates}
      openCreateItemSheet={openCreateItemSheet}
    />
  );
}
