"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { LoadingState } from "@/components/business";
import { BottomSheet, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, ledgerApiPath, type QuickTemplate } from "@/lib/api";
import { useLedger, useSheetStack } from "@/providers";
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

// 快捷模板列表已带齐预填所需字段，直接构建 seed，避免选择后再请求 /prefill 造成的 loading。
// 注意：不设置 occurredOn，保留用户在记账页当前已选的日期。
function templateToSeed(template: QuickTemplate): TransactionSeed {
  return {
    type: template.type,
    grossAmountMicros: template.amountMicros,
    categoryId: template.categoryId,
    subcategoryId: template.subcategoryId,
    personId: template.personId,
    accountId: template.accountId,
    subAccountId: template.subAccountId,
    fromAccountId: template.fromAccountId,
    fromSubAccountId: template.fromSubAccountId,
    toAccountId: template.toAccountId,
    toSubAccountId: template.toSubAccountId,
    note: template.note,
    relations: template.relationPayload,
    insuranceId: template.insuranceId,
    itemId: template.itemId,
    subscriptionId: template.subscriptionId,
  };
}

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
  const formId = useId();
  // 交互选择快捷模板时直接用列表数据构建 seed；仅 URL 预选（?template=）走一次 /prefill。
  const [selectedSeed, setSelectedSeed] = useState<TransactionSeed | null>(null);
  const [seedRevision, setSeedRevision] = useState(0);
  // 桌面「记一笔」本身就是一个 sheet-stack 弹层；再 push 快捷记账会顶掉本弹层导致其卸载、
  // 已选 seed 丢失。因此桌面改用内嵌本地 BottomSheet，表单保持挂载。
  const [quickOpen, setQuickOpen] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  // 记录表单当前日期，选择模板导致表单重挂载时用它保留用户已选日期。
  const occurredOnRef = useRef<string | null>(null);
  const handleSubmitBlockedChange = useCallback((handler: () => void) => {
    setSubmitBlocked(() => handler);
  }, []);
  const handleOccurredOnChange = useCallback((next: string) => {
    occurredOnRef.current = next;
  }, []);

  const prefillQuery = useQuery({
    queryKey: ["ledger", ledgerId, "quick-template-prefill", templateId],
    queryFn: () =>
      apiRequest<PrefillResponse>(ledgerApiPath(ledgerId!, `/quick-templates/${templateId}/prefill`)),
    enabled: Boolean(ledgerId) && Boolean(templateId) && !selectedSeed,
  });

  const prefillSeed: TransactionSeed | undefined = prefillQuery.data
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

  const seed = selectedSeed ?? prefillSeed;
  const seedKey = selectedSeed
    ? `seed:${seedRevision}`
    : templateId
      ? `template:${templateId}`
      : "blank";

  const waitingForPrefill = Boolean(templateId) && !selectedSeed && prefillQuery.isPending;
  const applyTemplate = useCallback((selected: QuickTemplate) => {
    // 保留用户当前已选日期：将其写入 seed，表单重挂载后不会被重置为今天。
    setSelectedSeed({
      ...templateToSeed(selected),
      occurredOn: occurredOnRef.current,
    });
    setSeedRevision((current) => current + 1);
  }, []);
  const openQuickTemplates = useCallback(() => {
    if (embedded) {
      // 桌面：内嵌本地弹层，避免 push 顶掉记一笔弹层造成表单卸载、seed 丢失。
      setQuickOpen(true);
      return;
    }
    push({
      title: "快捷记账",
      content: <QuickTemplateSheet directRunEnabled={false} onSelectTemplate={applyTemplate} />,
    });
  }, [applyTemplate, embedded, push]);
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
  const quickButton = (
    <IconButton
      disabled={!ledgerId || waitingForPrefill || saving}
      icon={<Zap size={22} strokeWidth={2.3} />}
      label="快捷记账"
      onClick={openQuickTemplates}
    />
  );
  const body =
    !ledgerId || waitingForPrefill ? (
      <LoadingState rows={5} title="加载中" />
    ) : (
      <TransactionForm
        formId={formId}
        key={seedKey}
        ledgerId={ledgerId}
        onCanSubmitChange={setCanSubmit}
        onOccurredOnChange={handleOccurredOnChange}
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
          <div className="flex items-center gap-1">
            {closeButton}
            {quickButton}
          </div>
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">记一笔</h2>
          {saveAction}
        </header>
        <div className="sheet-form-scroll flex-1">{body}</div>
        <BottomSheet
          className="ui-bottom-sheet--sheet-form"
          onClose={() => setQuickOpen(false)}
          open={quickOpen}
          title="快捷记账"
        >
          <QuickTemplateSheet
            directRunEnabled={false}
            onRequestClose={() => setQuickOpen(false)}
            onSelectTemplate={applyTemplate}
          />
        </BottomSheet>
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
