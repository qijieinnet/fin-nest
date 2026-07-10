"use client";

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
};

/**
 * 交易表单调度层：调用共享视图模型（A1）+ 承载含 JSX 的「新建物品」弹层动作，
 * 按断点分发到移动 / 桌面渲染层（B5）。移动端行为与改造前一致。
 */
export function TransactionForm({ formId, ...modelParams }: TransactionFormProps) {
  const { push } = useSheetStack();
  const isDesktop = useIsDesktop();
  const model = useTransactionFormModel(modelParams);

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
    <TransactionFormMobile formId={formId} model={model} openCreateItemSheet={openCreateItemSheet} />
  );
}
