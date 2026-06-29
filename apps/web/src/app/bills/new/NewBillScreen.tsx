"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { LoadingState } from "@/components/business";
import { ActionButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, ledgerApiPath } from "@/lib/api";
import { useLedger } from "@/providers";
import { TransactionForm, type TransactionSeed } from "../_components/TransactionForm";

type PrefillResponse = {
  type?: "expense" | "income";
  grossAmountMicros?: string;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  subAccountId?: string;
  personId?: string;
  note?: string;
};

export function NewBillScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const templateId = useSearchParams().get("template");
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
      apiRequest<PrefillResponse>(ledgerApiPath(ledgerId!, `/quick-templates/${templateId}/prefill`)),
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
        note: prefillQuery.data.note ?? null,
      }
    : undefined;

  const waitingForPrefill = Boolean(templateId) && prefillQuery.isPending;

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <ActionButton
            aria-disabled={!canSubmit || !ledgerId || waitingForPrefill || saving}
            className={!canSubmit && ledgerId && !waitingForPrefill && !saving ? "action-button--visual-disabled" : undefined}
            disabled={!ledgerId || waitingForPrefill || saving}
            form={formId}
            icon={<Check size={24} strokeWidth={2.6} />}
            label="保存"
            onClick={(event) => {
              if (!canSubmit) {
                event.preventDefault();
                submitBlocked?.();
              }
            }}
            tone="primary"
            type="submit"
          />
        }
        leading={
          <ActionButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="关闭"
            onClick={() => router.back()}
          />
        }
        title="记一笔"
      >
        {!ledgerId || waitingForPrefill ? (
          <LoadingState rows={5} title="加载中" />
        ) : (
          <TransactionForm
            formId={formId}
            key={templateId ?? "blank"}
            ledgerId={ledgerId}
            onCanSubmitChange={setCanSubmit}
            onPendingChange={setSaving}
            onSubmitBlocked={handleSubmitBlockedChange}
            seed={seed}
          />
        )}
      </MobilePage>
    </MobileAppShell>
  );
}
