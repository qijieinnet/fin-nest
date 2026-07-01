"use client";

import { cn } from "@/lib/format/class-names";
import { ToggleCard } from "./TransactionFieldRows";

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
  onSelect: (id: string) => void;
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
  return (
    <ToggleCard checked={checked} hint={hint} label={label} onCheckedChange={onCheckedChange}>
      {items.length === 0 ? (
        <p className="transaction-form__empty-text">{emptyText}</p>
      ) : (
        <div className="transaction-form__chip-row">
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                className={cn("transaction-form__chip", selected && "transaction-form__chip--selected")}
                key={item.id}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <span>{item.icon}</span>
                {item.name}
              </button>
            );
          })}
        </div>
      )}
    </ToggleCard>
  );
}
