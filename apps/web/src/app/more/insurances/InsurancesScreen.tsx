"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveX,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Edit3,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import {
  Button,
  EdgeFade,
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  MobilePage,
  PopoverMenu,
} from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Insurance,
  type Person,
} from "@/lib/api";
import { useInsurances, usePeople } from "@/lib/data/records";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { cn } from "@/lib/format/class-names";
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
import { InsuranceSortList, type InsuranceSortGroup } from "./_components/InsuranceSortList";
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
];

const TERMINATED_INSURANCE_STATUS_OPTIONS: AssetFilterOption[] = [
  { id: "terminated", label: "已终止" },
];

type InsuranceGroup = {
  key: string;
  meta: ReturnType<typeof insuranceTypeMeta>;
  items: Insurance[];
};

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

function compareInsurances(a: Insurance, b: Insurance): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

function insuredPeopleNames(insurance: Insurance, people: Person[]): string[] {
  const personById = new Map(people.map((person) => [person.id, person.name]));
  return (insurance.insuredPeople ?? [])
    .map((entry) => personById.get(entry.personId))
    .filter((name): name is string => Boolean(name));
}

function buildInsuranceFilterOptions(insurances: Insurance[]): AssetFilterOption[] {
  return buildInsuranceGroups(insurances).map((group) => ({
    icon: group.meta.icon,
    id: group.key,
    label: group.meta.label,
  }));
}

function filterInsurances(
  insurances: Insurance[],
  people: Person[],
  filterValue: AssetFilterValue,
  decimalPlaces: number,
): Insurance[] {
  const amountMinMicros = parseFilterMoney(filterValue.amountMin, decimalPlaces);
  const amountMaxMicros = parseFilterMoney(filterValue.amountMax, decimalPlaces);
  const keyword = filterValue.keyword?.trim().toLowerCase();

  return insurances.filter((insurance) => {
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
        insurance.paymentMethod,
        insurance.coverageDesc,
        insurance.note,
        meta.label,
        ...insuredPeopleNames(insurance, people),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }

    return true;
  });
}

function buildInsuranceGroups(insurances: Insurance[]): InsuranceGroup[] {
  const customTypes = Array.from(
    new Set(
      insurances
        .map((insurance) => insurance.type)
        .filter((type) => !KNOWN_INSURANCE_TYPE_VALUES.has(type)),
    ),
  );
  return [
    ...INSURANCE_TYPES.map((meta) => ({
      key: meta.value,
      meta,
      items: insurances
        .filter((insurance) => insurance.type === meta.value)
        .sort(compareInsurances),
    })),
    ...customTypes.map((type) => ({
      key: type,
      meta: insuranceTypeMeta(type),
      items: insurances.filter((insurance) => insurance.type === type).sort(compareInsurances),
    })),
  ]
    .filter((group) => group.items.length > 0)
    .sort((a, b) => {
      const orderA = a.items[0]?.typeSortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.items[0]?.typeSortOrder ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.meta.label.localeCompare(b.meta.label);
    });
}

type TerminatedInsurancesSheetProps = {
  decimalPlaces: number;
  insurances: Insurance[];
  people: Person[];
  renderRow: (insurance: Insurance) => ReactNode;
};

function TerminatedInsurancesSheet({
  decimalPlaces,
  insurances,
  people,
  renderRow,
}: TerminatedInsurancesSheetProps) {
  const { pop } = useSheetStack();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const filterOptions = buildInsuranceFilterOptions(insurances);
  const filteredInsurances = filterInsurances(insurances, people, filterValue, decimalPlaces);
  const groups = buildInsuranceGroups(filteredInsurances);

  const toggleGroup = (groupKey: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <AssetFilterSheet
        amountLabel="保费区间"
        categoryLabel="保险类型"
        categoryOptions={filterOptions}
        dateLabel="保障期间"
        keywordPlaceholder="搜索名称、被保人、公司、保单号..."
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        open={filterOpen}
        statusLabel="保单状态"
        statusOptions={TERMINATED_INSURANCE_STATUS_OPTIONS}
        value={filterValue}
      />

      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <div className="min-w-0 text-center">
          <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            已终止保单
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {filteredInsurances.length} / {insurances.length} 份
          </p>
        </div>
        <div className="relative">
          <IconButton
            icon={<SlidersHorizontal size={22} strokeWidth={2.2} />}
            label="筛选已终止保单"
            onClick={() => setFilterOpen(true)}
          />
          {activeFilterCount > 0 ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-accent-expense)]"
            />
          ) : null}
        </div>
      </div>

      {insurances.length === 0 ? (
        <EmptyState message="终止后的保单会集中放在这里。" title="还没有已终止保单" />
      ) : filteredInsurances.length === 0 ? (
        <EmptyState message="调整筛选条件后再试。" title="没有符合条件的保单" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => {
            const expanded = !collapsedIds.has(group.key);
            return (
              <section
                className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                key={group.key}
              >
                <button
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                    {group.meta.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {group.meta.label}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {group.items.length} 份
                  </span>
                  <ChevronDown
                    className={cn(
                      "text-[var(--color-text-muted)] transition-transform",
                      expanded && "rotate-180",
                    )}
                    size={18}
                  />
                </button>
                {expanded ? (
                  <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                    {group.items.map(renderRow)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InsurancesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const decimalPlaces = useDecimalPlaces();
  const isDesktop = useIsDesktop();
  const insurancesQuery = useInsurances(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<AssetFilterValue>({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const insurances = insurancesQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const currentInsurances = insurances.filter((insurance) => !insurance.terminatedAt);
  const terminatedInsurances = insurances.filter((insurance) => insurance.terminatedAt);
  const activeFilterCount = countActiveAssetFilters(filterValue);
  const insuranceFilterOptions = buildInsuranceFilterOptions(currentInsurances);
  const filteredInsurances = filterInsurances(
    currentInsurances,
    people,
    filterValue,
    decimalPlaces,
  );
  const active = filteredInsurances.filter(
    (insurance) => insuranceStatus(insurance).key === "active",
  );
  const annualPremium = active
    .reduce((sum, insurance) => sum + annualPremiumMicros(insurance), 0n)
    .toString();
  const coverageSum = active
    .reduce((sum, insurance) => sum + BigInt(insurance.coverageMicros ?? "0"), 0n)
    .toString();
  const insuranceGroups = buildInsuranceGroups(filteredInsurances);
  const sortGroups: InsuranceSortGroup[] = buildInsuranceGroups(currentInsurances).map((group) => ({
    icon: group.meta.icon,
    key: group.key,
    label: group.meta.label,
    items: group.items,
  }));
  const allGroupsCollapsed =
    insuranceGroups.length > 0 && insuranceGroups.every((group) => collapsedIds.has(group.key));
  const insurancesKey = queryKeys.insurances(ledgerId ?? "none");

  const invalidate = async () => {
    if (ledgerId) await queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) });
  };

  const terminate = useMutation({
    mutationFn: ({ id }: { id: string; expired: boolean }) =>
      apiRequest(ledgerApiPath(ledgerId!, `/insurances/${id}/terminate`), {
        method: "POST",
      }),
    onSuccess: async (_data, { id, expired }) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId!, id) }),
      ]);
      showToast({ tone: "success", message: expired ? "保单已归档" : "已终止续保" });
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

  const reorderInsurances = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/insurances/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: insurancesKey });
      showToast({ tone: "error", message: getApiErrorMessage(error, "排序保存失败，请重试") });
    },
  });

  const reorderInsuranceTypes = useMutation({
    mutationFn: (types: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/insurances/reorder-types"), {
        method: "PATCH",
        body: { types },
      }),
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: insurancesKey });
      showToast({
        tone: "error",
        message: getApiErrorMessage(error, "分类排序保存失败，请重试"),
      });
    },
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

  const toggleGroup = (groupKey: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const toggleAllGroups = () => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (allGroupsCollapsed) {
        insuranceGroups.forEach((group) => next.delete(group.key));
      } else {
        insuranceGroups.forEach((group) => next.add(group.key));
      }
      return next;
    });
  };

  const handleReorderInsurances = (_groupKey: string, orderedIds: string[]) => {
    queryClient.setQueryData<Insurance[]>(insurancesKey, (current) => {
      if (!current) return current;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return current.map((insurance) =>
        position.has(insurance.id)
          ? { ...insurance, sortOrder: position.get(insurance.id)! }
          : insurance,
      );
    });
    reorderInsurances.mutate(orderedIds);
  };

  const handleReorderTypes = (types: string[]) => {
    queryClient.setQueryData<Insurance[]>(insurancesKey, (current) => {
      if (!current) return current;
      const position = new Map(types.map((type, index) => [type, index]));
      return current.map((insurance) =>
        position.has(insurance.type)
          ? { ...insurance, typeSortOrder: position.get(insurance.type)! }
          : insurance,
      );
    });
    reorderInsuranceTypes.mutate(types);
  };

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
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

  const openTerminatedInsurances = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: (
        <TerminatedInsurancesSheet
          decimalPlaces={decimalPlaces}
          insurances={terminatedInsurances}
          people={people}
          renderRow={renderRow}
        />
      ),
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
          onTerminate={() =>
            terminate.mutate({
              id: insurance.id,
              expired: insuranceStatus(insurance).key === "expired",
            })
          }
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
    const insuredNames = insuredPeopleNames(insurance, people);
    const metaText = [
      insuredNames.length > 0 ? `${insuredNames.join("、")}` : "未指定被保人",
      meta.label,
      insurance.insurer,
      premiumFreqLabel(insurance.premiumFreq),
    ]
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
      <SwipeActionRow actions={actions} desktopClickable key={insurance.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => openDetail(insurance)}
          type="button"
        >
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
        keywordPlaceholder="搜索名称、被保人、公司、保单号..."
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
          sortMode ? (
            <Button onClick={() => setSortMode(false)} variant="primary">
              完成
            </Button>
          ) : (
            <div className="relative flex justify-end">
              <IconButtonGroup
                items={[
                  {
                    dot: activeFilterCount > 0,
                    icon: <SlidersHorizontal size={20} strokeWidth={2.2} />,
                    label: "筛选保单",
                    onClick: () => setFilterOpen(true),
                  },
                  {
                    icon: <MoreHorizontal size={22} strokeWidth={2.3} />,
                    label: "更多选项",
                    onClick: () => setMoreMenuOpen((open) => !open),
                  },
                ]}
              />
              <PopoverMenu
                groups={[
                  // 桌面端把「添加保单」收进更多菜单；移动端保留右下角悬浮按钮。
                  ...(isDesktop
                    ? [
                        [
                          {
                            icon: <Plus size={18} />,
                            label: "添加保单",
                            onSelect: () => {
                              setMoreMenuOpen(false);
                              openEditor();
                            },
                          },
                        ],
                      ]
                    : []),
                  [
                    {
                      icon: allGroupsCollapsed ? (
                        <ChevronsUpDown size={18} />
                      ) : (
                        <ChevronsDownUp size={18} />
                      ),
                      label: allGroupsCollapsed ? "展开所有" : "折叠所有",
                      onSelect: toggleAllGroups,
                    },
                    {
                      icon: <ArrowUpDown size={18} />,
                      label: "排序",
                      onSelect: () => {
                        setMoreMenuOpen(false);
                        setSortMode(true);
                      },
                    },
                    {
                      description: `${terminatedInsurances.length} 份`,
                      icon: <ArchiveX size={18} />,
                      label: "已终止",
                      onSelect: openTerminatedInsurances,
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          )
        }
        description="集中管理家庭保单，记录保额、保费与到期日，并可上传保单附件。"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={sortMode ? "退出排序" : "返回"}
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title={sortMode ? "拖动排序" : "保险管理"}
      >
        <div className="flex flex-col gap-3 pb-6">
          {insurancesQuery.isPending || peopleQuery.isPending ? (
            <LoadingState rows={4} title="加载保单" />
          ) : insurances.length === 0 ? (
            <EmptyState
              message="把寿险、医疗、车险等保单录入，保额保费一目了然，到期不漏缴。"
              title="还没有添加保单"
            />
          ) : sortMode ? (
            <>
              <p className="px-1 text-xs text-[var(--color-text-muted)]">
                按住右侧图标拖动排序；保险分类整体移动，保单仅在所属分类内排序。
              </p>
              <InsuranceSortList
                collapsedIds={collapsedIds}
                groups={sortGroups}
                onReorderInsurances={handleReorderInsurances}
                onReorderTypes={handleReorderTypes}
              />
            </>
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
                insuranceGroups.map((group) => {
                  const expanded = !collapsedIds.has(group.key);
                  return (
                    <section
                      className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
                      key={group.key}
                    >
                      <button
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-2 px-4 py-3 text-left"
                        onClick={() => toggleGroup(group.key)}
                        type="button"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
                          {group.meta.icon}
                        </span>
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
                          {group.meta.label}
                        </span>
                        <span className="text-xs font-medium text-[var(--color-text-muted)]">
                          {group.items.length} 份
                        </span>
                        <ChevronDown
                          className={cn(
                            "text-[var(--color-text-muted)] transition-transform",
                            expanded && "rotate-180",
                          )}
                          size={18}
                        />
                      </button>
                      {expanded ? (
                        <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                          {group.items.map(renderRow)}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              )}
            </>
          )}
        </div>
      </MobilePage>
      <EdgeFade />

      {!isDesktop && !sortMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
          <div className="relative w-[min(100vw,430px)]">
            <div className="pointer-events-auto absolute bottom-[calc(var(--space-tab-bar-height)+34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] bg-[var(--color-tint)] shadow-[var(--shadow-app)]">
              <button
                aria-label="添加保单"
                className="flex h-full w-full items-center justify-center text-[var(--color-tint-contrast)]"
                onClick={() => openEditor()}
                type="button"
              >
                <Plus size={22} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </MobileAppShell>
  );
}
