"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BottomSheet, Tabs } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption, CategoryOption, TransactionType } from "./business-types";
import { CategorySelectionList } from "./CategorySelectionList";
import type { BusinessFilterValue, FilterField } from "./filter-types";
import { resetFilterValue } from "./filter-utils";

type FilterSheetProps = {
  accountOptions?: BusinessOption[];
  categoryOptions?: CategoryOption[];
  creatorOptions?: BusinessOption[];
  fields: FilterField[];
  onApply: () => void;
  onChange: (value: BusinessFilterValue) => void;
  onOpenChange: (open: boolean) => void;
  onReset?: () => void;
  open: boolean;
  personOptions?: BusinessOption[];
  value: BusinessFilterValue;
};

type FilterTab = "分类" | "时间" | "账户" | "其它";

const typePills: Array<{ label: string; value: TransactionType | "all" }> = [
  { label: "全部", value: "all" },
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
  { label: "转账", value: "transfer" },
];

const timePills: Array<{ label: string; value: NonNullable<BusinessFilterValue["timePreset"]> }> = [
  { label: "本月", value: "month" },
  { label: "上月", value: "lastmonth" },
  { label: "本周", value: "week" },
  { label: "上周", value: "lastweek" },
  { label: "近30天", value: "30d" },
  { label: "今年", value: "year" },
  { label: "上年", value: "lastyear" },
  { label: "全部", value: "all" },
  { label: "自定义", value: "custom" },
];

function hasField(fields: FilterField[], field: FilterField): boolean {
  return fields.includes(field);
}

function toggleValue(list: string[] = [], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function selectedList(single?: string | null, many?: string[]): string[] {
  if (many?.length) return many;
  return single ? [single] : [];
}

function FilterChip({
  icon,
  label,
  onClick,
  selected,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      className={cn("biz-filter-chip", selected && "biz-filter-chip--selected")}
      onClick={onClick}
      type="button"
    >
      {icon ? <span>{icon}</span> : null}
      {label}
    </button>
  );
}

export function FilterSheet({
  accountOptions = [],
  categoryOptions = [],
  creatorOptions = [],
  fields,
  onApply,
  onChange,
  onOpenChange,
  onReset,
  open,
  personOptions = [],
  value,
}: FilterSheetProps) {
  const [tab, setTab] = useState<FilterTab>("分类");
  const [draft, setDraft] = useState<BusinessFilterValue>(value);
  const categoryIds = selectedList(draft.categoryId, draft.categoryIds);
  const accountIds = selectedList(draft.accountId, draft.accountIds);
  const personIds = selectedList(draft.personId, draft.personIds);
  const creatorIds = selectedList(draft.creatorId, draft.creatorIds);
  const subcategoryIds = draft.subcategoryIds ?? [];

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function patch(next: Partial<BusinessFilterValue>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function toggleAccount(id: string) {
    const option = accountOptions.find((item) => item.id === id);
    const selected = accountIds.includes(id);
    let next: string[];
    if (option?.parentId) {
      next = accountIds.filter((item) => item !== id && item !== option.parentId);
      if (!selected) next.push(id);
    } else if (option) {
      const childIds = accountOptions
        .filter((item) => item.parentId === option.id)
        .map((item) => item.id);
      next = accountIds.filter((item) => item !== id && !childIds.includes(item));
      if (!selected) next.push(id);
    } else {
      next = toggleValue(accountIds, id);
    }
    patch({ accountId: next.at(-1) ?? null, accountIds: next });
  }

  const primaryAccountOptions = accountOptions.filter((account) => !account.parentId);

  const tabs = useMemo(() => {
    const next: FilterTab[] = [];
    if (hasField(fields, "type") || hasField(fields, "category")) next.push("分类");
    if (hasField(fields, "dateRange")) next.push("时间");
    if (hasField(fields, "account")) next.push("账户");
    if (
      hasField(fields, "keyword") ||
      hasField(fields, "person") ||
      hasField(fields, "creator") ||
      hasField(fields, "amountRange")
    )
      next.push("其它");
    return next.length ? next : (["分类"] as FilterTab[]);
  }, [fields]);

  // 选中的页签可能不在当前字段生成的页签列表里（如只启用「时间」时默认的「分类」缺失），回退到首个可用页签。
  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? "分类");

  const effectiveType = draft.type ?? "all";
  const categoriesForType = categoryOptions.filter((option) => {
    if (option.parentId) return false;
    if (effectiveType === "income" || effectiveType === "expense")
      return option.kind === effectiveType || !option.kind;
    return true;
  });
  const visibleCategoryOptions = categoryOptions.filter((option) => {
    if (!option.parentId) return categoriesForType.some((category) => category.id === option.id);
    return categoriesForType.some((category) => category.id === option.parentId);
  });

  return (
    <BottomSheet
      className="ui-bottom-sheet--filter"
      onClose={() => onOpenChange(false)}
      open={open}
      title="过滤条件"
    >
      <div className="biz-filter-prototype">
        <div className="biz-filter-prototype__actions">
          <button
            onClick={() => {
              const next = resetFilterValue();
              setDraft(next);
              onReset?.();
            }}
            type="button"
          >
            重置
          </button>
          <span>过滤条件</span>
          <button
            onClick={() => {
              onChange(draft);
              onApply();
              onOpenChange(false);
            }}
            type="button"
          >
            完成
          </button>
        </div>

        <Tabs
          className="biz-filter-tabs"
          items={tabs.map((item) => ({ label: item, value: item }))}
          onValueChange={(nextTab) => setTab(nextTab as FilterTab)}
          value={activeTab}
        />

        <div className="biz-filter-prototype__body">
          {activeTab === "分类" ? (
            <>
              {hasField(fields, "type") ? (
                <>
                  <p className="biz-filter-label">交易类型</p>
                  <div className="biz-filter-chip-row">
                    {typePills.map((pill) => (
                      <FilterChip
                        key={pill.value}
                        label={pill.label}
                        onClick={() =>
                          patch({
                            categoryId: null,
                            categoryIds: [],
                            subcategoryIds: [],
                            type: pill.value,
                          })
                        }
                        selected={effectiveType === pill.value}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {hasField(fields, "category") && effectiveType !== "transfer" ? (
                <>
                  <p className="biz-filter-label">分类（可选到二级，多选）</p>
                  <CategorySelectionList
                    highlightParentWhenChildSelected={false}
                    onSelect={(option, parent) => {
                      if (parent) {
                        patch({ subcategoryIds: toggleValue(subcategoryIds, option.id) });
                        return;
                      }

                      const next = toggleValue(categoryIds, option.id);
                      patch({ categoryId: next.at(-1) ?? null, categoryIds: next });
                    }}
                    options={visibleCategoryOptions}
                    selectedIds={categoryIds}
                    selectedSubcategoryIds={subcategoryIds}
                  />
                </>
              ) : null}

              {effectiveType === "transfer" ? (
                <p className="biz-filter-hint">转账记录不区分分类，可在「账户」中筛选。</p>
              ) : null}
            </>
          ) : null}

          {activeTab === "时间" ? (
            <>
              <p className="biz-filter-label">时间范围</p>
              <div className="biz-filter-chip-row">
                {timePills.map((pill) => (
                  <FilterChip
                    key={pill.value}
                    label={pill.label}
                    onClick={() => patch({ timePreset: pill.value })}
                    selected={(draft.timePreset ?? "month") === pill.value}
                  />
                ))}
              </div>
              {(draft.timePreset ?? "month") === "custom" ? (
                <div className="biz-filter-date-range biz-filter-date-range--custom">
                  <label className="biz-filter-date-cell">
                    <span className="biz-filter-date-caption">开始日期</span>
                    <input
                      onChange={(event) => patch({ dateFrom: event.currentTarget.value })}
                      placeholder="选择日期"
                      type="date"
                      value={draft.dateFrom ?? ""}
                    />
                  </label>
                  <span>—</span>
                  <label className="biz-filter-date-cell">
                    <span className="biz-filter-date-caption">结束日期</span>
                    <input
                      onChange={(event) => patch({ dateTo: event.currentTarget.value })}
                      placeholder="选择日期"
                      type="date"
                      value={draft.dateTo ?? ""}
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : null}

          {activeTab === "账户" ? (
            <>
              <p className="biz-filter-label">账户（可选到子账户，多选）</p>
              <div className="biz-category-picker-sheet">
                {primaryAccountOptions.map((account) => {
                  const subOptions = accountOptions.filter(
                    (option) => option.parentId === account.id,
                  );
                  return (
                    <section className="biz-category-group" key={account.id}>
                      <button
                        className={cn(
                          "biz-category-chip",
                          "biz-category-chip--primary",
                          accountIds.includes(account.id) && "biz-category-chip--selected",
                        )}
                        onClick={() => toggleAccount(account.id)}
                        type="button"
                      >
                        {account.icon ? (
                          <span className="biz-category-icon">{account.icon}</span>
                        ) : null}
                        <span>{account.label}</span>
                      </button>

                      {subOptions.length ? (
                        <div className="biz-category-subchips">
                          {subOptions.map((sub) => (
                            <button
                              className={cn(
                                "biz-category-chip",
                                "biz-category-chip--sub",
                                accountIds.includes(sub.id) && "biz-category-chip--selected",
                              )}
                              key={sub.id}
                              onClick={() => toggleAccount(sub.id)}
                              type="button"
                            >
                              {sub.icon ? (
                                <span className="biz-category-icon">{sub.icon}</span>
                              ) : null}
                              <span>{sub.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </>
          ) : null}

          {activeTab === "其它" ? (
            <>
              {hasField(fields, "keyword") ? (
                <>
                  <p className="biz-filter-label">备注搜索</p>
                  <input
                    className="biz-filter-input"
                    onChange={(event) => patch({ keyword: event.currentTarget.value })}
                    placeholder="输入备注关键词..."
                    value={draft.keyword ?? ""}
                  />
                </>
              ) : null}

              {hasField(fields, "person") ? (
                <>
                  <p className="biz-filter-label">人员（可多选）</p>
                  <div className="biz-filter-chip-row">
                    {personOptions.map((person) => (
                      <FilterChip
                        key={person.id}
                        label={person.label}
                        onClick={() => {
                          const next = toggleValue(personIds, person.id);
                          patch({ personId: next.at(-1) ?? null, personIds: next });
                        }}
                        selected={personIds.includes(person.id)}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {hasField(fields, "creator") ? (
                <>
                  <p className="biz-filter-label">记账人 / 创建人（可多选）</p>
                  <div className="biz-filter-chip-row">
                    {creatorOptions.map((creator) => (
                      <FilterChip
                        key={creator.id}
                        label={creator.label}
                        onClick={() => {
                          const next = toggleValue(creatorIds, creator.id);
                          patch({ creatorId: next.at(-1) ?? null, creatorIds: next });
                        }}
                        selected={creatorIds.includes(creator.id)}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {hasField(fields, "amountRange") ? (
                <>
                  <p className="biz-filter-label">金额区间</p>
                  <div className="biz-filter-date-range">
                    <input
                      inputMode="decimal"
                      onChange={(event) => patch({ amountMin: event.currentTarget.value })}
                      placeholder="最小"
                      type="text"
                      value={draft.amountMin ?? ""}
                    />
                    <span>—</span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => patch({ amountMax: event.currentTarget.value })}
                      placeholder="最大"
                      type="text"
                      value={draft.amountMax ?? ""}
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
}
