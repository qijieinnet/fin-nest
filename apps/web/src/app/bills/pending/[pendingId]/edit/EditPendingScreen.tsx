"use client";

import { Check, X } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useAutoPending } from "@/lib/data/records";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger } from "@/providers";
import { TransactionForm } from "../../../_components/TransactionForm";
import { TransactionFormFab } from "../../../_components/TransactionFormFab";

export function EditPendingScreen({ pendingId }: { pendingId: string }) {
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

  const pendingQuery = useAutoPending(ledgerId);
  const pending = pendingQuery.data?.find((item) => item.id === pendingId);
  const waiting = pendingQuery.isPending;

  return (
    <MobileAppShell>
      {/* 键盘展开时把它的高度补进页面底部内边距，否则靠后的字段被永久遮住。 */}
      <div data-keypad-open={keypadOpen ? "true" : undefined}>
        <MobilePage
          action={
            <IconButton
              aria-disabled={!canSubmit || !ledgerId || waiting || saving || !pending}
              className={
                !canSubmit && ledgerId && !waiting && !saving && pending
                  ? "ui-icon-button--visual-disabled"
                  : undefined
              }
              disabled={!ledgerId || waiting || saving || !pending}
              form={formId}
              icon={<Check size={24} strokeWidth={2.6} />}
              label="确认入账"
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
          }
          description="保存修改后将直接确认入账"
          leading={
            <IconButton
              icon={<X size={24} strokeWidth={2.3} />}
              label="关闭"
              onClick={() => router.back()}
            />
          }
          title="编辑并确认"
        >
          {!ledgerId || waiting ? (
            <LoadingState rows={5} title="加载待确认记录" />
          ) : pending ? (
            <TransactionForm
              formId={formId}
              keypadOpen={keypadOpen}
              keypadSubmitLabel="确认入账"
              ledgerId={ledgerId}
              onCanSubmitChange={setCanSubmit}
              onKeypadOpenChange={setKeypadOpen}
              onPendingChange={setSaving}
              onSubmitBlocked={handleSubmitBlockedChange}
              pending={pending}
            />
          ) : (
            <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">
              待确认记录不存在或已处理。
            </p>
          )}
        </MobilePage>
      </div>
      {/* 键盘展开时 FAB 让位：提交入口已搬进键盘，留着就是重复入口。 */}
      {keypadOpen ? null : (
        <TransactionFormFab
          canSubmit={canSubmit}
          disabled={!ledgerId || waiting || saving || !pending}
          formId={formId}
          loading={saving}
          onSubmitBlocked={() => submitBlocked?.()}
          submitLabel="确认入账"
        />
      )}
    </MobileAppShell>
  );
}
