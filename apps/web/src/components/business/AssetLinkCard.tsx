"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
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
  createLabel?: string;
  onCheckedChange: (checked: boolean) => void;
  onCreate?: () => void;
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
  createLabel,
  onCheckedChange,
  onCreate,
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
        <div className="flex flex-col gap-3">
          <p className="transaction-form__empty-text">{emptyText}</p>
          {onCreate ? (
            <Button icon={<Plus size={16} />} onClick={onCreate} type="button" variant="secondary">
              {createLabel ?? `新建${label}`}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
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
          {onCreate ? (
            <Button icon={<Plus size={16} />} onClick={onCreate} type="button" variant="secondary">
              {createLabel ?? `新建${label}`}
            </Button>
          ) : null}
        </div>
      )}
    </ToggleCard>
  );
}
