"use client";

import { useMemo } from "react";
import { ToggleCard } from "./TransactionFieldRows";
import { SearchableOptionSelectRow } from "./SearchableOptionSelectRow";

export type AssetLinkOption = {
  id: string;
  icon: string;
  name: string;
};

type AssetLinkCardProps = {
  checked: boolean;
  emptyText: string;
  hint: string;
  items: AssetLinkOption[];
  label: string;
  onCheckedChange: (checked: boolean) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
};

/** 保险 / 物品这类「开关 + 单选卡片」的关联字段，账单与自动记账共用。 */
export function AssetLinkCard({
  checked,
  emptyText,
  hint,
  items,
  label,
  onCheckedChange,
  onSelect,
  selectedId,
}: AssetLinkCardProps) {
  const options = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        icon: item.icon,
        label: item.name,
      })),
    [items],
  );

  return (
    <ToggleCard checked={checked} hint={hint} label={label} onCheckedChange={onCheckedChange}>
      {items.length === 0 ? (
        <p className="transaction-form__empty-text">{emptyText}</p>
      ) : (
        <SearchableOptionSelectRow
          emptyText={emptyText}
          hideLabel
          label={label}
          onValueChange={onSelect}
          options={options}
          placeholder={`选择${label}`}
          searchPlaceholder={`搜索${label}`}
          value={selectedId}
        />
      )}
    </ToggleCard>
  );
}
