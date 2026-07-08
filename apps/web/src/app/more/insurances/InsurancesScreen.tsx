"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { IconButton, IconButtonGroup, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Insurance } from "@/lib/api";
import { useInsurances, usePeople } from "@/lib/data/records";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useConfirm, useDecimalPlaces, useLedger, useSheetStack, useToast } from "@/providers";
import {
  AssetFilterSheet,
  countActiveAssetFilters,
  type AssetFilterOption,
  type AssetFilterValue,
} from "../_components/AssetFilterSheet";
import { InsuranceDetailSheet } from "./_components/InsuranceDetailSheet";
import { InsuranceEditorSheet } from "./_components/InsuranceEditorSheet";
import {
  INSURANCE_TYPES,
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

const KNOWN_INSURANCE_TYPE_VALUES: ReadonlySet<string> = new Set(
  INSURANCE_TYPES.map((type) => type.value),
);

const INSURANCE_STATUS_OPTIONS: AssetFilterOption[] = [
  { id: "active", label: "在保" },
  { id: "expired", label: "已过期" },
  { id: "terminated", label: "已终止" },
];

function parseFilterMoney(value: string | undefined, decimalPlaces: number): bigint | null {
  if (!value) return null;
  const parsed = parseMoneyToMicros(value, { decimalPlaces });
  return parsed.ok ? BigInt(parsed.amountMicros) : null;
}

function insuranceMatchesDateRange(
  insurance: Pick<Insurance, "endDate" | "startDate">,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): boolean {
  if (!dateFrom && !dateTo) return true;
  const startDate = insurance.startDate?.slice(0, 10) ?? null;
  const endDate = insurance.endDate?.slice(0, 10) ?? null;
  if (!startDate && !endDate) return false;
  if (dateFrom && endDate && endDate < dateFrom) return false;
  if (dateTo && startDate && startDate > dateTo) return false;
  return true;
}

export function InsurancesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const decimalPlaces = useDecimalPlaces();
  const insurancesQuery = useInsurances(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});

  const insurances = insurancesQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const customInsuranceTypeOptions = Array.from(
    new Set(
      insurances
        .map((insurance) => insurance.type)
        .filter((type) => !KNOWN_INSURANCE_TYPE_VALUES.has(type)),
    ),
  ).map((type) => {
    const meta = insuranceTypeMeta(type);
    return { icon: meta.icon, id: type, label: meta.label };
  });
  const insuranceFilterOptions: AssetFilterOption[] = [
    ...INSURANCE_TYPES.map((type) => ({ icon: type.icon, id: type.value, label: type.label })),
    ...customInsuranceTypeOptions,
  ];
  const amountMinMicros = parseFilterMoney(filterValue.amountMin, decimalPlaces);
  const amountMaxMicros = parseFilterMoney(filterValue.amountMax, decimalPlaces);
  const keyword = filterValue.keyword?.trim().toLowerCase();
  const filteredInsurances = insurances.filter((insurance) => {
    if (filterValue.categoryIds?.length && !filterValue.categoryIds.includes(insurance.type)) {
      return false;
    }

    const status = insuranceStatus(insurance);
    if (filterValue.statusIds?.length && !filterValue.statusIds.includes(status.key)) {
      return false;
    }

    const premium = BigInt(insurance.premiumMicros ?? "0");
    if (amountMinMicros !== null && premium < amountMinMicros) return false;
    if (amountMaxMicros !== null && premium > amountMaxMicros) return false;

    if (!insuranceMatchesDateRange(insurance, filterValue.dateFrom, filterValue.dateTo)) {
      return false;
    }

    if (keyword) {
      const meta = insuranceTypeMeta(insurance.type);
      const searchable = [
        insurance.name,
        insurance.insurer,
        insurance.policyNo,
        insurance.method,
        insurance.coverageDesc,
        insurance.note,
        meta.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }

    return true;
  });
  const active = filteredInsurances.filter(
    (insurance) => insuranceStatus(insurance).key === "active",
  );
  const annualPremium = active
    .reduce((sum, insurance) => sum + annualPremiumMicros(insurance), 0n)
    .toString();
  const coverageSum = active
    .reduce((sum, insurance) => sum + BigInt(insurance.coverageMicros ?? "0"), 0n)
    .toString();
  const customInsuranceGroups = filteredInsurances.reduce((groups, insurance) => {
    if (KNOWN_INSURANCE_TYPE_VALUES.has(insurance.type)) return groups;
    const items = groups.get(insurance.type) ?? [];
    items.push(insurance);
    groups.set(insurance.type, items);
    return groups;
  }, new Map<string, Insurance[]>());
  const insuranceGroups = [
    ...INSURANCE_TYPES.map((meta) => ({
      key: meta.value,
      meta,
      items: filteredInsurances.filter((insurance) => insurance.type === meta.value),
    })),
    ...Array.from(customInsuranceGroups, ([type, items]) => ({
      key: type,
      meta: insuranceTypeMeta(type),
      items,
    })),
  ].filter((group) => group.items.length > 0);

  const invalidate = async () => {
    if (ledgerId) await queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) });
  };

  const terminate = useMutation({
    mutationFn: (insuranceId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}/terminate`), {
        method: "POST",
      }),
    onSuccess: async (_data, insuranceId) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId!, insuranceId) }),
      ]);
      showToast({ tone: "success", message: "已终止续保" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

  const resume = useMutation({
    mutationFn: (insuranceId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}/resume`), {
        method: "POST",
      }),
    onSuccess: async (_data, insuranceId) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId!, insuranceId) }),
      ]);
      showToast({ tone: "success", message: "已恢复保单" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

  const remove = useMutation({
    mutationFn: (insuranceId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "success", message: "保单已删除" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const confirmDelete = async (insurance: Insurance) => {
    if (remove.isPending) return;
    const confirmed = await confirm({
      title: `删除「${insurance.name}」？`,
      message: "关联的记账记录会保留，仅移除该保单。",
      confirmText: "删除",
      tone: "danger",
    });
    if (confirmed) remove.mutate(insurance.id);
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (insurance?: Insurance) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <InsuranceEditorSheet insurance={insurance} ledgerId={ledgerId} people={people} />,
    });
  };

  const openDetail = (insurance: Insurance) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      title: "保单详情",
      content: (
        <InsuranceDetailSheet
          insuranceId={insurance.id}
          ledgerId={ledgerId}
          onDelete={() => confirmDelete(insurance)}
          onEdit={() => openEditor(insurance)}
          onResume={() => resume.mutate(insurance.id)}
          onTerminate={() => terminate.mutate(insurance.id)}
          people={people}
          resuming={resume.isPending}
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
        onClick: () => confirmDelete(insurance),
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
          {/* <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] text-[21px]">
            {meta.icon}
          </span> */}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                {insurance.name}
              </span>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status.tone]}`}
              >
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
              {metaText}
            </span>
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
      <AssetFilterSheet
        amountLabel="保费区间"
        categoryLabel="保险类型"
        categoryOptions={insuranceFilterOptions}
        dateLabel="保障期间"
        keywordPlaceholder="搜索名称、公司、保单号..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="保单状态"
        statusOptions={INSURANCE_STATUS_OPTIONS}
        value={filterValue}
      />
      <MobilePage
        action={
          <IconButtonGroup
            items={[
              {
                dot: activeFilterCount > 0,
                icon: <SlidersHorizontal size={20} strokeWidth={2.2} />,
                label: "筛选保单",
                onClick: () => setFilterOpen(true),
              },
              {
                icon: <Plus size={22} strokeWidth={2.3} />,
                label: "添加保单",
                onClick: () => openEditor(),
              },
            ]}
          />
        }
        description="集中管理家庭保单，记录保额、保费与到期日，并可上传保单附件。"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
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
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  年缴保费合计
                </div>
                <p className="mt-1.5 flex items-baseline gap-0.5">
                  <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">
                    ¥
                  </span>
                  <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                    {formatMoney(annualPremium)}
                  </span>
                </p>
                <div className="mt-3.5 flex gap-7">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      在保保单
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">{active.length} 份</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      保额合计
                    </div>
                    <div className="mt-0.5 block text-[15px] font-semibold">
                      {formatMoney(coverageSum)}
                    </div>
                  </div>
                </div>
              </section>

              {filteredInsurances.length === 0 ? (
                <EmptyState message="调整筛选条件后再试。" title="没有符合条件的保单" />
              ) : (
                insuranceGroups.map((group) => (
                  <section
                    className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                    key={group.key}
                  >
                    <div className="flex items-center gap-2 px-4 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                        {group.meta.icon}
                      </span>
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                        {group.meta.label}
                      </span>
                      <span className="text-xs font-medium text-[var(--color-text-muted)]">
                        {group.items.length} 份
                      </span>
                    </div>
                    <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                      {group.items.map(renderRow)}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
