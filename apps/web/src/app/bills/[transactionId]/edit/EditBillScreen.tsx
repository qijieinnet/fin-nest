"use client";

import { Check, X } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useTransaction } from "@/lib/data/records";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger } from "@/providers";
import { TransactionForm } from "../../_components/TransactionForm";
import { TransactionFormFab } from "../../_components/TransactionFormFab";

export function EditBillScreen({
  transactionId,
  embedded = false,
  onClose,
}: {
  transactionId: string;
  // 作为二级弹层内容渲染：去掉整页外壳，关闭沿用弹层的历史返回。
  embedded?: boolean;
  onClose?: () => void;
}) {
  const router = useAppRouter();
  const { ledgerId } = useLedger();
  const formId = useId();
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  // 金额键盘展开态：FAB 要据此让位，页面底部也要补出键盘高度。
  // 编辑不像新建那样自动展开（设置项针对的是记账页），只在点金额区时展开。
  const [keypadOpen, setKeypadOpen] = useState(false);
  const handleSubmitBlockedChange = useCallback((handler: () => void) => {
    setSubmitBlocked(() => handler);
  }, []);
  const transactionQuery = useTransaction(ledgerId, transactionId);
  const waitingForTransaction = transactionQuery.isPending;
  const hasTransaction = Boolean(transactionQuery.data);

  const saveAction = (
    <IconButton
      aria-disabled={!canSubmit || !ledgerId || waitingForTransaction || saving || !hasTransaction}
      className={
        !canSubmit && ledgerId && !waitingForTransaction && !saving && hasTransaction
          ? "ui-icon-button--visual-disabled"
          : undefined
      }
      disabled={!ledgerId || waitingForTransaction || saving || !hasTransaction}
      form={formId}
      icon={<Check size={24} strokeWidth={2.6} />}
      label="保存"
      loading={saving}
      onClick={(event) => {
        if (!canSubmit) {
          event.preventDefault();
          submitBlocked?.();
        }
      }}
      variant="primary"
      type="submit"
    />
  );

  const closeButton = (
    <IconButton
      icon={<X size={24} strokeWidth={2.3} />}
      label="关闭"
      onClick={() => (onClose ? onClose() : router.back())}
    />
  );

  const body =
    !ledgerId || waitingForTransaction ? (
      <LoadingState rows={5} title="加载交易" />
    ) : transactionQuery.data ? (
      <TransactionForm
        formId={formId}
        initial={transactionQuery.data}
        keypadOpen={embedded ? undefined : keypadOpen}
        ledgerId={ledgerId}
        onCanSubmitChange={setCanSubmit}
        onKeypadOpenChange={embedded ? undefined : setKeypadOpen}
        onPendingChange={setSaving}
        onSubmitBlocked={handleSubmitBlockedChange}
      />
    ) : (
      <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">交易不存在或已删除。</p>
    );

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 px-1 pb-2">
          {closeButton}
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">编辑交易</h2>
          {saveAction}
        </header>
        <div className="sheet-form-scroll flex-1">{body}</div>
      </div>
    );
  }

  return (
    <MobileAppShell>
      {/* 键盘展开时把它的高度补进页面底部内边距，否则靠后的字段被永久遮住。 */}
      <div data-keypad-open={keypadOpen ? "true" : undefined}>
        <MobilePage action={saveAction} leading={closeButton} title="编辑交易">
          {body}
        </MobilePage>
      </div>
      {/* 键盘展开时 FAB 让位：保存入口已搬进键盘，留着就是重复入口。 */}
      {keypadOpen ? null : (
        <TransactionFormFab
          canSubmit={canSubmit}
          disabled={!ledgerId || waitingForTransaction || saving || !hasTransaction}
          formId={formId}
          loading={saving}
          onSubmitBlocked={() => submitBlocked?.()}
        />
      )}
    </MobileAppShell>
  );
}
