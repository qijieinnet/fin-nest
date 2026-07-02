"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useTransaction } from "@/lib/data/records";
import { useLedger } from "@/providers";
import { TransactionForm } from "../../_components/TransactionForm";

export function EditBillScreen({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const formId = useId();
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const handleSubmitBlockedChange = useCallback((handler: () => void) => {
    setSubmitBlocked(() => handler);
  }, []);
  const transactionQuery = useTransaction(ledgerId, transactionId);
  const waitingForTransaction = transactionQuery.isPending;
  const hasTransaction = Boolean(transactionQuery.data);

  return (
    <MobileAppShell>
      <MobilePage
        action={
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
            onClick={(event) => {
              if (!canSubmit) {
                event.preventDefault();
                submitBlocked?.();
              }
            }}
            variant="primary"
            type="submit"
          />
        }
        leading={
          <IconButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="关闭"
            onClick={() => router.back()}
          />
        }
        title="编辑交易"
      >
        {!ledgerId || waitingForTransaction ? (
          <LoadingState rows={5} title="加载交易" />
        ) : transactionQuery.data ? (
          <TransactionForm
            formId={formId}
            initial={transactionQuery.data}
            ledgerId={ledgerId}
            onCanSubmitChange={setCanSubmit}
            onPendingChange={setSaving}
            onSubmitBlocked={handleSubmitBlockedChange}
          />
        ) : (
          <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">交易不存在或已删除。</p>
        )}
      </MobilePage>
    </MobileAppShell>
  );
}
