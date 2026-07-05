"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, ledgerApiPath } from "@/lib/api";
import { useLedger } from "@/providers";
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
  const formId = useId();
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const handleSubmitBlockedChange = useCallback((handler: () => void) => {
    setSubmitBlocked(() => handler);
  }, []);

  const prefillQuery = useQuery({
    queryKey: ["ledger", ledgerId, "quick-template-prefill", templateId],
    queryFn: () =>
      apiRequest<PrefillResponse>(
        ledgerApiPath(ledgerId!, `/quick-templates/${templateId}/prefill`),
      ),
    enabled: Boolean(ledgerId) && Boolean(templateId),
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

  const waitingForPrefill = Boolean(templateId) && prefillQuery.isPending;
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
        key={templateId ?? "blank"}
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
    </MobileAppShell>
  );
}
