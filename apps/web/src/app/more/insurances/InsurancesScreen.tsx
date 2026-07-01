"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { ActionButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Insurance } from "@/lib/api";
import { useInsurances, usePeople } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { DeleteInsuranceConfirmDialog } from "./_components/DeleteInsuranceConfirmDialog";
import { InsuranceDetailSheet } from "./_components/InsuranceDetailSheet";
import { InsuranceEditorSheet } from "./_components/InsuranceEditorSheet";
import {
  annualPremiumMicros,
  formatMoney,
  insuranceStatus,
  insuranceTypeMeta,
  premiumFreqLabel,
} from "./_components/insurance-utils";

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  expired: "bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]",
  terminated: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

export function InsurancesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const insurancesQuery = useInsurances(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const [insurancePendingDelete, setInsurancePendingDelete] = useState<Insurance | null>(null);

  const insurances = insurancesQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const active = insurances.filter((insurance) => insuranceStatus(insurance).key === "active");
  const annualPremium = active
    .reduce((sum, insurance) => sum + annualPremiumMicros(insurance), 0n)
    .toString();
  const coverageSum = active
    .reduce((sum, insurance) => sum + BigInt(insurance.coverageMicros ?? "0"), 0n)
    .toString();

  const invalidate = async () => {
    if (ledgerId) await queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) });
  };

  const terminate = useMutation({
    mutationFn: (insuranceId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}/terminate`), { method: "POST" }),
    onSuccess: async (_data, insuranceId) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId!, insuranceId) }),
      ]);
      showToast({ tone: "success", message: "已终止续保" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

  const remove = useMutation({
    mutationFn: (insuranceId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      setInsurancePendingDelete(null);
      showToast({ tone: "success", message: "保单已删除" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (insurance?: Insurance) => {
    if (!ledgerId) return;
    push({
      className: "glass-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: <InsuranceEditorSheet insurance={insurance} ledgerId={ledgerId} people={people} />,
    });
  };

  const openDetail = (insurance: Insurance) => {
    if (!ledgerId) return;
    push({
      title: "保单详情",
      content: (
        <InsuranceDetailSheet
          insuranceId={insurance.id}
          ledgerId={ledgerId}
          onDelete={() => setInsurancePendingDelete(insurance)}
          onEdit={() => openEditor(insurance)}
          onTerminate={() => terminate.mutate(insurance.id)}
          people={people}
          terminating={terminate.isPending}
        />
      ),
    });
  };

  const renderRow = (insurance: Insurance) => {
    const meta = insuranceTypeMeta(insurance.type);
    const status = insuranceStatus(insurance);
    const metaText = [meta.label, insurance.insurer, premiumFreqLabel(insurance.premiumFreq)]
      .filter(Boolean)
      .join(" · ");
    const actions: SwipeAction[] = [
      {
        icon: <Edit3 size={18} />,
        label: `编辑${insurance.name}`,
        onClick: () => openEditor(insurance),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${insurance.name}`,
        onClick: () => setInsurancePendingDelete(insurance),
        tone: "danger",
      },
    ];

    return (
      <SwipeActionRow actions={actions} key={insurance.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => openDetail(insurance)}
          type="button"
        >
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] text-[21px]">
            {meta.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                {insurance.name}
              </span>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status.tone]}`}>
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">{metaText}</span>
          </span>
          {insurance.premiumMicros ? (
            <span className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {formatMoney(insurance.premiumMicros)}
            </span>
          ) : null}
        </button>
      </SwipeActionRow>
    );
  };

  return (
    <MobileAppShell>
      <DeleteInsuranceConfirmDialog
        deleting={remove.isPending}
        insurance={insurancePendingDelete}
        onCancel={() => {
          if (!remove.isPending) setInsurancePendingDelete(null);
        }}
        onConfirm={() => {
          if (insurancePendingDelete && !remove.isPending) remove.mutate(insurancePendingDelete.id);
        }}
      />
      <MobilePage
        action={
          <ActionButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="添加保单"
            onClick={() => openEditor()}
          />
        }
        description="集中管理家庭保单，记录保额、保费与到期日，并可上传保单附件。"
        leading={
          <ActionButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="保险管理"
      >
        <div className="flex flex-col gap-3 pb-6">
          {insurancesQuery.isPending ? (
            <LoadingState rows={4} title="加载保单" />
          ) : insurances.length === 0 ? (
            <EmptyState
              message="把寿险、医疗、车险等保单录入，保额保费一目了然，到期不漏缴。"
              title="还没有添加保单"
            />
          ) : (
            <>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] font-medium tracking-wide text-[var(--color-text-muted)]">
                  年缴保费合计
                </div>
                <div className="mt-1 text-[30px] font-bold tracking-tight text-[var(--color-text-primary)]">
                  {formatMoney(annualPremium)}
                </div>
                <div className="mt-3 flex gap-7">
                  <div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">在保保单</div>
                    <div className="mt-0.5 text-[15px] font-semibold text-[var(--color-text-primary)]">
                      {active.length} 份
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">保额合计</div>
                    <div className="mt-0.5 text-[15px] font-semibold text-[var(--color-text-primary)]">
                      {formatMoney(coverageSum)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <div className="divide-y divide-black/[0.06]">{insurances.map(renderRow)}</div>
              </section>
            </>
          )}

          <button
            className="mt-1 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={() => openEditor()}
            type="button"
          >
            <Plus size={17} />
            添加保单
          </button>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
