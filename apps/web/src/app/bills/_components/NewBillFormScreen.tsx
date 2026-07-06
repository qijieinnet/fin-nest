"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, ledgerApiPath } from "@/lib/api";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { QuickTemplateSheet } from "./QuickTemplateSheet";
import { TransactionForm, type TransactionSeed } from "./TransactionForm";

type PrefillResponse = {
  type?: TransactionSeed["type"];
  grossAmountMicros?: string;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  subAccountId?: string;
  fromAccountId?: string;
  fromSubAccountId?: string;
  toAccountId?: string;
  toSubAccountId?: string;
  personId?: string;
  note?: string;
  relations?: Array<{ accountId: string; relationKind: string; amountMicros: string }>;
  insuranceId?: string | null;
  itemId?: string | null;
};

type NewBillFormScreenProps = {
  embedded?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
  templateId?: string | null;
};

export function NewBillFormScreen({
  embedded = false,
  onClose,
  onSaved,
  templateId,
}: NewBillFormScreenProps) {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const formId = useId();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templateId ?? null);
  const [prefillRevision, setPrefillRevision] = useState(0);
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const handleSubmitBlockedChange = useCallback((handler: () => void) => {
    setSubmitBlocked(() => handler);
  }, []);

  const prefillQuery = useQuery({
    queryKey: ["ledger", ledgerId, "quick-template-prefill", selectedTemplateId, prefillRevision],
    queryFn: () =>
      apiRequest<PrefillResponse>(
        ledgerApiPath(ledgerId!, `/quick-templates/${selectedTemplateId}/prefill`),
      ),
    enabled: Boolean(ledgerId) && Boolean(selectedTemplateId),
  });

  const seed: TransactionSeed | undefined = prefillQuery.data
    ? {
        type: prefillQuery.data.type,
        grossAmountMicros: prefillQuery.data.grossAmountMicros ?? null,
        categoryId: prefillQuery.data.categoryId ?? null,
        subcategoryId: prefillQuery.data.subcategoryId ?? null,
        personId: prefillQuery.data.personId ?? null,
        accountId: prefillQuery.data.accountId ?? null,
        subAccountId: prefillQuery.data.subAccountId ?? null,
        fromAccountId: prefillQuery.data.fromAccountId ?? null,
        fromSubAccountId: prefillQuery.data.fromSubAccountId ?? null,
        toAccountId: prefillQuery.data.toAccountId ?? null,
        toSubAccountId: prefillQuery.data.toSubAccountId ?? null,
        note: prefillQuery.data.note ?? null,
        relations: prefillQuery.data.relations ?? null,
        insuranceId: prefillQuery.data.insuranceId ?? null,
        itemId: prefillQuery.data.itemId ?? null,
      }
    : undefined;

  const waitingForPrefill = Boolean(selectedTemplateId) && prefillQuery.isPending;
  const openQuickTemplates = useCallback(() => {
    push({
      title: "快捷记账",
      content: (
        <QuickTemplateSheet
          directRunEnabled={false}
          onSelectTemplate={(selected) => {
            setSelectedTemplateId(selected.id);
            setPrefillRevision((current) => current + 1);
            // showToast({ tone: "success", message: "已填充快速记账" });
          }}
        />
      ),
    });
  }, [push, showToast]);
  const saveAction = (
    <IconButton
      aria-disabled={!canSubmit || !ledgerId || waitingForPrefill || saving}
      className={
        !canSubmit && ledgerId && !waitingForPrefill && !saving
          ? "ui-icon-button--visual-disabled"
          : undefined
      }
      disabled={!ledgerId || waitingForPrefill || saving}
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
    !ledgerId || waitingForPrefill ? (
      <LoadingState rows={5} title="加载中" />
    ) : (
      <TransactionForm
        formId={formId}
        key={selectedTemplateId ? `${selectedTemplateId}:${prefillRevision}` : "blank"}
        ledgerId={ledgerId}
        onCanSubmitChange={setCanSubmit}
        onPendingChange={setSaving}
        onSaved={onSaved}
        onSubmitBlocked={handleSubmitBlockedChange}
        seed={seed}
      />
    );

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 px-1 pb-2">
          {closeButton}
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">记一笔</h2>
          {saveAction}
        </header>
        <div className="sheet-form-scroll flex-1">{body}</div>
      </div>
    );
  }

  return (
    <MobileAppShell>
      <MobilePage action={saveAction} leading={closeButton} title="记一笔">
        {body}
      </MobilePage>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
        <div className="relative w-[min(100vw,430px)]">
          <button
            aria-label="快捷记账"
            className="pointer-events-auto absolute bottom-[calc(34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] border border-white/50 bg-[rgba(255,255,255,0.62)] text-[var(--color-text-primary)] shadow-[var(--shadow-app)] backdrop-blur-xl"
            onClick={openQuickTemplates}
            type="button"
          >
            <Zap size={20} />
          </button>
        </div>
      </div>
    </MobileAppShell>
  );
}
