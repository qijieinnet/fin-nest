"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { GlassBottomSheet } from "@/components/glass";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption, CategoryOption, TransactionType } from "./business-types";
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
    <button className={cn("biz-filter-chip", selected && "biz-filter-chip--selected")} onClick={onClick} type="button">
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

  const tabs = useMemo(() => {
    const next: FilterTab[] = [];
    if (hasField(fields, "type") || hasField(fields, "category")) next.push("分类");
    if (hasField(fields, "dateRange")) next.push("时间");
    if (hasField(fields, "account")) next.push("账户");
    if (hasField(fields, "keyword") || hasField(fields, "person") || hasField(fields, "creator") || hasField(fields, "amountRange")) next.push("其它");
    return next.length ? next : (["分类"] as FilterTab[]);
  }, [fields]);

  const effectiveType = draft.type ?? "all";
  const categoriesForType = categoryOptions.filter((option) => {
    if (option.parentId) return false;
    if (effectiveType === "income" || effectiveType === "expense") return option.kind === effectiveType || !option.kind;
    return true;
  });

  return (
    <GlassBottomSheet
      className="glass-bottom-sheet--filter"
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

        <div className="biz-filter-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              aria-selected={tab === item}
              className={cn(tab === item && "biz-filter-tabs__item--selected")}
              key={item}
              onClick={() => setTab(item)}
              role="tab"
              type="button"
            >
              {item}
            </button>
          ))}
        </div>

        <div className="biz-filter-prototype__body">
          {tab === "分类" ? (
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
                  <div className="biz-filter-category-list">
                    {categoriesForType.map((category) => {
                      const children = categoryOptions.filter((option) => option.parentId === category.id);
                      const selected = categoryIds.includes(category.id);
                      return (
                        <div className="biz-filter-category" key={category.id}>
                          <FilterChip
                            icon={category.icon}
                            label={category.label}
                            onClick={() => {
                              const next = toggleValue(categoryIds, category.id);
                              patch({ categoryId: next.at(-1) ?? null, categoryIds: next });
                            }}
                            selected={selected}
                          />
                          {children.length ? (
                            <div className="biz-filter-chip-row biz-filter-chip-row--sub">
                              {children.map((child) => {
                                const childSelected = subcategoryIds.includes(child.id);
                                return (
                                  <FilterChip
                                    icon={child.icon}
                                    key={child.id}
                                    label={child.label}
                                    onClick={() => patch({ subcategoryIds: toggleValue(subcategoryIds, child.id) })}
                                    selected={childSelected}
                                  />
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {effectiveType === "transfer" ? <p className="biz-filter-hint">转账记录不区分分类，可在「账户」中筛选。</p> : null}
            </>
          ) : null}

          {tab === "时间" ? (
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
                <div className="biz-filter-date-range">
                  <input onChange={(event) => patch({ dateFrom: event.currentTarget.value })} type="date" value={draft.dateFrom ?? ""} />
                  <span>—</span>
                  <input onChange={(event) => patch({ dateTo: event.currentTarget.value })} type="date" value={draft.dateTo ?? ""} />
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "账户" ? (
            <>
              <p className="biz-filter-label">账户（可多选）</p>
              <div className="biz-filter-chip-row">
                {accountOptions.map((account) => (
                  <FilterChip
                    icon={account.icon}
                    key={account.id}
                    label={account.label}
                    onClick={() => {
                      const next = toggleValue(accountIds, account.id);
                      patch({ accountId: next.at(-1) ?? null, accountIds: next });
                    }}
                    selected={accountIds.includes(account.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {tab === "其它" ? (
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
    </GlassBottomSheet>
  );
}
