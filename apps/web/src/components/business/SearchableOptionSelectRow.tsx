"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { BottomSheet, Button, Input } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption } from "./business-types";

type SearchableOptionSelectRowProps = {
  className?: string;
  emptyText?: string;
  hideLabel?: boolean;
  label: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  title?: string;
  value: string | null;
  visibleStep?: number;
};

type DisplayOption = BusinessOption & {
  searchText: string;
};

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function optionSearchText(option: BusinessOption, options: BusinessOption[]): string {
  const parent = option.parentId ? options.find((item) => item.id === option.parentId) : null;
  return [option.label, option.description, parent?.label].filter(Boolean).join(" ").toLowerCase();
}

function toDisplayOptions(options: BusinessOption[]): DisplayOption[] {
  return options.map((option) => {
    const parent = option.parentId ? options.find((item) => item.id === option.parentId) : null;
    return {
      ...option,
      description: option.description ?? parent?.label,
      searchText: optionSearchText(option, options),
    };
  });
}

function nestedOptionLabel(
  options: Array<{ id: string; label: string; parentId?: string }>,
  value: string | null,
  fallback: string,
): string {
  const selected = options.find((option) => option.id === value);
  if (!selected) return fallback;
  if (!selected.parentId) return selected.label;
  const parent = options.find((option) => option.id === selected.parentId);
  return parent ? `${parent.label}/${selected.label}` : selected.label;
}

export function SearchableOptionSelectRow({
  className,
  emptyText = "暂无可选项",
  hideLabel = false,
  label,
  onValueChange,
  options,
  placeholder = "请选择",
  searchPlaceholder = "搜索名称",
  title = label,
  value,
  visibleStep = 40,
}: SearchableOptionSelectRowProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [visibleCount, setVisibleCount] = useState(visibleStep);
  const displayValue = nestedOptionLabel(options, value, placeholder);
  const keywordText = normalizeKeyword(keyword);
  const hasKeyword = keywordText.length > 0;
  const displayOptions = useMemo(() => toDisplayOptions(options), [options]);
  const primaryOptions = useMemo(
    () => displayOptions.filter((option) => !option.parentId),
    [displayOptions],
  );
  const filteredOptions = useMemo(
    () =>
      hasKeyword
        ? displayOptions.filter((option) => option.searchText.includes(keywordText))
        : displayOptions,
    [displayOptions, hasKeyword, keywordText],
  );
  const visibleOptions = filteredOptions.slice(0, visibleCount);
  const visiblePrimaryOptions = primaryOptions.slice(0, visibleCount);
  const hasMore = hasKeyword
    ? filteredOptions.length > visibleCount
    : primaryOptions.length > visibleCount;

  useEffect(() => {
    if (!open) {
      setKeyword("");
      setVisibleCount(visibleStep);
    }
  }, [open, visibleStep]);

  useEffect(() => {
    setVisibleCount(visibleStep);
  }, [keywordText, visibleStep]);

  function selectOption(option: BusinessOption) {
    if (option.disabled) return;
    onValueChange(option.id);
    setOpen(false);
  }

  function renderOption(option: BusinessOption, sub = false) {
    const selected = option.id === value;
    const hasIcon = Boolean(option.icon);
    return (
      <button
        aria-selected={selected}
        className={cn(
          "transaction-form__option-row",
          sub && "transaction-form__option-row--sub",
          hasIcon && "transaction-form__option-row--with-icon",
        )}
        disabled={option.disabled}
        key={option.id}
        onClick={() => selectOption(option)}
        type="button"
      >
        {hasIcon ? <span className="transaction-form__option-icon">{option.icon}</span> : null}
        <span className="transaction-form__option-copy">
          <strong>{option.label}</strong>
          {option.description ? <small>{option.description}</small> : null}
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        className={cn(
          "transaction-form__select-row",
          hideLabel && "transaction-form__select-row--value-only",
          className,
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        {hideLabel ? null : <span>{label}</span>}
        <strong>{displayValue}</strong>
        <ChevronRight size={18} />
      </button>

      <BottomSheet
        className="ui-bottom-sheet--transaction-picker ui-bottom-sheet--searchable-picker"
        onClose={() => setOpen(false)}
        open={open}
        title={title}
      >
        <div className="transaction-form__searchable-picker">
          <div className="transaction-form__search-row">
            <Search size={17} />
            <Input
              aria-label={searchPlaceholder}
              label={searchPlaceholder}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={searchPlaceholder}
              value={keyword}
            />
          </div>

          <div className="transaction-form__option-list">
            {filteredOptions.length === 0 ? <p className="biz-muted">{emptyText}</p> : null}

            {hasKeyword
              ? visibleOptions.map((option) => renderOption(option))
              : visiblePrimaryOptions.map((option) => {
                  const children = displayOptions.filter((child) => child.parentId === option.id);
                  return (
                    <section className="transaction-form__option-group" key={option.id}>
                      {renderOption(option)}
                      {children.length > 0 ? (
                        <div className="transaction-form__suboption-list">
                          {children.map((child) => renderOption(child, true))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}

            {hasMore ? (
              <Button
                onClick={() => setVisibleCount((count) => count + visibleStep)}
                variant="secondary"
              >
                加载更多
              </Button>
            ) : null}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
