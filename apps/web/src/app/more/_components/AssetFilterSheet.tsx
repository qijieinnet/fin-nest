"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BottomSheet, Tabs } from "@/components/ui";
import { cn } from "@/lib/format/class-names";

export type AssetFilterOption = {
  icon?: ReactNode;
  id: string;
  label: string;
};

export type AssetFilterValue = {
  amountMax?: string;
  amountMin?: string;
  categoryIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  statusIds?: string[];
};

type AssetFilterTab = "分类" | "状态" | "金额" | "日期" | "其它";

type AssetFilterSheetProps = {
  amountLabel: string;
  categoryLabel: string;
  categoryOptions: AssetFilterOption[];
  dateLabel: string;
  keywordPlaceholder: string;
  onApply: () => void;
  onChange: (value: AssetFilterValue) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  statusLabel: string;
  statusOptions: AssetFilterOption[];
  value: AssetFilterValue;
};

function toggleValue(list: string[] = [], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function countActiveAssetFilters(value: AssetFilterValue): number {
  let count = 0;
  if (value.categoryIds?.length) count += 1;
  if (value.statusIds?.length) count += 1;
  if (value.amountMin || value.amountMax) count += 1;
  if (value.dateFrom || value.dateTo) count += 1;
  if (value.keyword) count += 1;
  return count;
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

export function AssetFilterSheet({
  amountLabel,
  categoryLabel,
  categoryOptions,
  dateLabel,
  keywordPlaceholder,
  onApply,
  onChange,
  onOpenChange,
  open,
  statusLabel,
  statusOptions,
  value,
}: AssetFilterSheetProps) {
  const [tab, setTab] = useState<AssetFilterTab>("分类");
  const [draft, setDraft] = useState<AssetFilterValue>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const tabs = useMemo(() => {
    const next: AssetFilterTab[] = [];
    if (categoryOptions.length > 0) next.push("分类");
    if (statusOptions.length > 0) next.push("状态");
    next.push("金额", "日期", "其它");
    return next;
  }, [categoryOptions.length, statusOptions.length]);

  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? "其它");

  function patch(next: Partial<AssetFilterValue>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function reset() {
    const next: AssetFilterValue = {};
    setDraft(next);
    onChange(next);
  }

  return (
    <BottomSheet
      className="ui-bottom-sheet--filter"
      onClose={() => onOpenChange(false)}
      open={open}
      title="过滤条件"
    >
      <div className="biz-filter-prototype">
        <div className="biz-filter-prototype__actions">
          <button onClick={reset} type="button">
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
          onValueChange={(nextTab) => setTab(nextTab as AssetFilterTab)}
          value={activeTab}
        />

        <div className="biz-filter-prototype__body">
          {activeTab === "分类" ? (
            <>
              <p className="biz-filter-label">{categoryLabel}（可多选）</p>
              <div className="biz-filter-chip-row">
                {categoryOptions.map((option) => (
                  <FilterChip
                    icon={option.icon}
                    key={option.id}
                    label={option.label}
                    onClick={() =>
                      patch({ categoryIds: toggleValue(draft.categoryIds, option.id) })
                    }
                    selected={draft.categoryIds?.includes(option.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {activeTab === "状态" ? (
            <>
              <p className="biz-filter-label">{statusLabel}（可多选）</p>
              <div className="biz-filter-chip-row">
                {statusOptions.map((option) => (
                  <FilterChip
                    icon={option.icon}
                    key={option.id}
                    label={option.label}
                    onClick={() => patch({ statusIds: toggleValue(draft.statusIds, option.id) })}
                    selected={draft.statusIds?.includes(option.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {activeTab === "金额" ? (
            <>
              <p className="biz-filter-label">{amountLabel}</p>
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

          {activeTab === "日期" ? (
            <>
              <p className="biz-filter-label">{dateLabel}</p>
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
            </>
          ) : null}

          {activeTab === "其它" ? (
            <>
              <p className="biz-filter-label">关键词</p>
              <input
                className="biz-filter-input"
                onChange={(event) => patch({ keyword: event.currentTarget.value })}
                placeholder={keywordPlaceholder}
                value={draft.keyword ?? ""}
              />
            </>
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
}
