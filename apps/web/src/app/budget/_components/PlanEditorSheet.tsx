"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { DateWheelPicker, FieldCard, FilterSheet } from "@/components/business";
import { IconButton, Input, PopoverMenu, Switch, Tabs } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Plan,
  type PlanKind,
  type PlanMatchRule,
  type PlanMetric,
  type PlanRepeatRule,
} from "@/lib/api";
import { useAccounts, useCategories, usePeople } from "@/lib/data/records";
import { categoryOptions, personOptions } from "@/lib/data/options";
import type { BusinessFilterValue } from "@/components/business";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { microsToInput, parseLimitCount, REPEAT_OPTIONS, todayKey } from "./plan-utils";

type PlanEditorSheetProps = {
  defaultKind?: PlanKind;
  ledgerId: string;
  plan?: Plan;
};

type Option<TValue extends string> = {
  label: string;
  value: TValue;
};

const KIND_OPTIONS: Array<Option<PlanKind>> = [
  { value: "expense", label: "支出限额" },
  { value: "income", label: "收入目标" },
];

const METRIC_OPTIONS: Array<Option<PlanMetric>> = [
  { value: "amount", label: "金额" },
  { value: "count", label: "次数" },
];

function TextFieldRow({
  inputMode,
  label,
  maxLength,
  onChange,
  placeholder,
  prefix,
  value,
}: {
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  prefix?: string;
  value: string;
}) {
  return (
    <FieldCard className="transaction-form__note-card" label={label}>
      <div className="transaction-form__note-row">
        <span>{label}</span>
        <Input
          aria-label={label}
          inputMode={inputMode}
          label={label}
          maxLength={maxLength}
          onChange={onChange}
          placeholder={placeholder}
          prefix={prefix}
          value={value}
        />
      </div>
    </FieldCard>
  );
}

function SelectRow<TValue extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: TValue) => void;
  options: ReadonlyArray<Option<TValue>>;
  value: TValue;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <div className="transaction-form__card transaction-form__picker-card">
      <div className="relative">
        <button
          className="transaction-form__select-row"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{label}</span>
          <strong>{selected?.label ?? "请选择"}</strong>
          <ChevronRight size={18} />
        </button>
        <PopoverMenu
          groups={[
            options.map((option) => ({
              label: option.label,
              onSelect: () => onChange(option.value),
              selected: option.value === value,
            })),
          ]}
          onOpenChange={setOpen}
          open={open}
        />
      </div>
    </div>
  );
}

function activeFilterCount({
  accountIds,
  categoryIds,
  noteContains,
  personIds,
  subcategoryIds,
}: {
  accountIds: string[];
  categoryIds: string[];
  noteContains: string;
  personIds: string[];
  subcategoryIds: string[];
}) {
  let count = 0;
  if (categoryIds.length) count += 1;
  if (subcategoryIds.length) count += 1;
  if (accountIds.length) count += 1;
  if (personIds.length) count += 1;
  if (noteContains.trim()) count += 1;
  return count;
}

export function PlanEditorSheet({ defaultKind = "expense", ledgerId, plan }: PlanEditorSheetProps) {
  const queryClient = useQueryClient();
  const decimalPlaces = useDecimalPlaces();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(plan);

  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);

  const [kind, setKind] = useState<PlanKind>(plan?.kind ?? defaultKind);
  const [metric, setMetric] = useState<PlanMetric>(plan?.metric ?? "amount");
  const [name, setName] = useState(plan?.name ?? "");
  const [limitAmount, setLimitAmount] = useState(() =>
    microsToInput(plan?.limitAmountMicros, decimalPlaces),
  );
  const [limitCount, setLimitCount] = useState(plan?.limitCount ? String(plan.limitCount) : "");
  const [startDate, setStartDate] = useState(plan?.startDate.slice(0, 10) ?? todayKey());
  const [repeatRule, setRepeatRule] = useState<PlanRepeatRule>(plan?.repeatRule ?? "monthly");
  const [periodConfirmEnabled, setPeriodConfirmEnabled] = useState(
    plan?.periodConfirmEnabled ?? false,
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(plan?.matchRule?.categoryIds ?? []);
  const [subcategoryIds, setSubcategoryIds] = useState<string[]>(
    plan?.matchRule?.subcategoryIds ?? [],
  );
  const [accountIds, setAccountIds] = useState<string[]>(plan?.matchRule?.accountIds ?? []);
  const [personIds, setPersonIds] = useState<string[]>(plan?.matchRule?.personIds ?? []);
  const [noteContains, setNoteContains] = useState(plan?.matchRule?.noteContains ?? "");
  const [filterOpen, setFilterOpen] = useState(false);

  const filterCategoryOptions = useMemo(
    () => categoryOptions(categoriesQuery.data ?? [], kind),
    [categoriesQuery.data, kind],
  );
  const filterAccountOptions = useMemo(
    () =>
      (accountsQuery.data ?? [])
        .filter((account) => ["savings", "credit", "invest"].includes(account.type))
        .map((account) => ({
          id: account.id,
          label: account.name,
          icon: account.icon ?? undefined,
        })),
    [accountsQuery.data],
  );
  const filterPersonOptions = useMemo(
    () => personOptions(peopleQuery.data ?? []),
    [peopleQuery.data],
  );
  const validCategoryIds = useMemo(
    () =>
      categoryIds.filter((id) =>
        filterCategoryOptions.some((option) => !option.parentId && option.id === id),
      ),
    [categoryIds, filterCategoryOptions],
  );
  const validSubcategoryIds = useMemo(
    () =>
      subcategoryIds.filter((id) =>
        filterCategoryOptions.some((option) => option.parentId && option.id === id),
      ),
    [filterCategoryOptions, subcategoryIds],
  );
  const filterCount = activeFilterCount({
    accountIds,
    categoryIds: validCategoryIds,
    noteContains,
    personIds,
    subcategoryIds: validSubcategoryIds,
  });
  const filterSummary = filterCount === 0 ? "全部记账" : `已设置 ${filterCount} 项`;
  const filterValue = useMemo<BusinessFilterValue>(
    () => ({
      accountId: accountIds.at(-1) ?? null,
      accountIds,
      categoryId: validCategoryIds.at(-1) ?? null,
      categoryIds: validCategoryIds,
      keyword: noteContains,
      personId: personIds.at(-1) ?? null,
      personIds,
      subcategoryIds: validSubcategoryIds,
      type: kind,
    }),
    [accountIds, kind, noteContains, personIds, validCategoryIds, validSubcategoryIds],
  );

  const save = useMutation({
    mutationFn: async () => {
      let limitAmountMicros: string | undefined;
      let limitCountValue: number | undefined;
      if (metric === "amount") {
        const parsed = parseMoneyToMicros(limitAmount, { decimalPlaces });
        if (!parsed.ok || BigInt(parsed.amountMicros) <= 0n) throw new Error("请填写大于 0 的金额");
        limitAmountMicros = parsed.amountMicros;
      } else {
        const parsedCount = parseLimitCount(limitCount);
        if (parsedCount === null) throw new Error("请填写大于 0 的整数次数");
        limitCountValue = parsedCount;
      }

      const matchRule: PlanMatchRule = {};
      if (validCategoryIds.length) matchRule.categoryIds = validCategoryIds;
      if (validSubcategoryIds.length) matchRule.subcategoryIds = validSubcategoryIds;
      if (accountIds.length) matchRule.accountIds = accountIds;
      if (personIds.length) matchRule.personIds = personIds;
      if (noteContains.trim()) matchRule.noteContains = noteContains.trim();

      const body = {
        ...(plan ? {} : { kind }),
        metric,
        name: name.trim() || (kind === "income" ? "收入目标" : "支出限额"),
        limitAmountMicros,
        limitCount: limitCountValue,
        startDate,
        repeatRule,
        matchRule,
        // 不重复的计划没有下一期，开关无意义，一律按关提交。
        periodConfirmEnabled: repeatRule === "once" ? false : periodConfirmEnabled,
      };
      return plan
        ? apiRequest<Plan>(ledgerApiPath(ledgerId, `/plans/${plan.id}`), { method: "PATCH", body })
        : apiRequest<Plan>(ledgerApiPath(ledgerId, "/plans"), { method: "POST", body });
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, saved.id) }),
      ]);
      showToast({ tone: "success", message: isEditing ? "计划已更新" : "计划已创建" });
      pop();
    },
  });

  return (
    <>
      <form
        className="transaction-form flex min-h-0 flex-1 flex-col !gap-0 !pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-2">
          <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
          <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
            {isEditing ? "编辑计划" : "新计划"}
          </h2>
          <IconButton
            disabled={save.isPending}
            icon={<Check size={24} strokeWidth={2.6} />}
            label="保存计划"
            loading={save.isPending}
            variant="primary"
            type="submit"
          />
        </div>

        <div className="sheet-form-scroll flex-1 pb-6">
          <div className="transaction-form__cards">
            <Tabs
              className="transaction-form__type-tabs"
              items={
                isEditing ? KIND_OPTIONS.filter((option) => option.value === kind) : KIND_OPTIONS
              }
              onValueChange={(value) => setKind(value as PlanKind)}
              value={kind}
            />

            <TextFieldRow
              label="计划名称"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="选填，如 拿铁基金"
              value={name}
            />

            <SelectRow
              label="目标类型"
              onChange={setMetric}
              options={METRIC_OPTIONS}
              value={metric}
            />

            {metric === "amount" ? (
              <TextFieldRow
                inputMode="decimal"
                label={`${kind === "income" ? "收入" : "支出"}金额`}
                onChange={(event) => setLimitAmount(event.target.value)}
                placeholder="0"
                prefix="¥"
                value={limitAmount}
              />
            ) : (
              <TextFieldRow
                inputMode="numeric"
                label={`${kind === "income" ? "收入" : "支出"}次数`}
                onChange={(event) => setLimitCount(event.target.value)}
                placeholder="0"
                value={limitCount}
              />
            )}

            <FieldCard className="transaction-form__date-card" label="开始日期">
              <DateWheelPicker label="开始日期" onValueChange={setStartDate} value={startDate} />
            </FieldCard>

            <SelectRow
              label="重复"
              onChange={setRepeatRule}
              options={REPEAT_OPTIONS}
              value={repeatRule}
            />

            {repeatRule === "once" ? null : (
              <section className="transaction-form__card">
                <div className="transaction-form__toggle-head">
                  <span>
                    <strong>周期结束需确认</strong>
                    <small>本期结束后卡片停在本期显示结算，确认后才进入下一期</small>
                  </span>
                  <Switch
                    checked={periodConfirmEnabled}
                    label="周期结束需确认"
                    onCheckedChange={setPeriodConfirmEnabled}
                  />
                </div>
              </section>
            )}

            <button
              className="transaction-form__row-card"
              onClick={() => setFilterOpen(true)}
              type="button"
            >
              <span className="font-semibold">过滤条件</span>
              <strong>{filterSummary}</strong>
              <ChevronRight size={18} />
            </button>

            <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
              不设置过滤条件时，统计该方向的全部记账；设置后仅统计命中的记账。
            </p>
          </div>
        </div>
      </form>

      <FilterSheet
        accountOptions={filterAccountOptions}
        categoryOptions={filterCategoryOptions}
        fields={["category", "account", "person", "keyword"]}
        onApply={() => undefined}
        onChange={(next) => {
          setCategoryIds(next.categoryIds ?? (next.categoryId ? [next.categoryId] : []));
          setSubcategoryIds(next.subcategoryIds ?? []);
          setAccountIds(next.accountIds ?? (next.accountId ? [next.accountId] : []));
          setPersonIds(next.personIds ?? (next.personId ? [next.personId] : []));
          setNoteContains(next.keyword ?? "");
        }}
        onOpenChange={setFilterOpen}
        onReset={() => {
          setCategoryIds([]);
          setSubcategoryIds([]);
          setAccountIds([]);
          setPersonIds([]);
          setNoteContains("");
        }}
        open={filterOpen}
        personOptions={filterPersonOptions}
        value={filterValue}
      />
    </>
  );
}
