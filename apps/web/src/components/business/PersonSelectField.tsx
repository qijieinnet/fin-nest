"use client";

import { cn } from "@/lib/format/class-names";
import type { BusinessOption } from "./business-types";
import { ToggleCard } from "./TransactionFieldRows";

type PersonSelectFieldProps = {
  checked: boolean;
  disabled?: boolean;
  emptyText?: string;
  label?: string;
  onCheckedChange: (checked: boolean) => void;
  onValueChange: (id: string) => void;
  options: BusinessOption[];
  value: string | null;
};

type PersonChipRowProps = {
  emptyText?: string;
  onValueChange: (id: string) => void;
  options: BusinessOption[];
  value: string | null;
};

/** 人员单选 chip 行。表单卡片与金额键盘的人员面板共用，避免两处各写一份选中态。 */
export function PersonChipRow({
  emptyText = "还没有人员，可到人员管理中添加",
  onValueChange,
  options,
  value,
}: PersonChipRowProps) {
  if (options.length === 0) {
    return <p className="transaction-form__empty-text">{emptyText}</p>;
  }

  return (
    <div className="transaction-form__people-row">
      {options.map((person) => (
        <button
          className={cn(
            "transaction-form__chip",
            person.id === value && "transaction-form__chip--selected",
          )}
          key={person.id}
          onClick={() => onValueChange(person.id)}
          type="button"
        >
          {person.label}
        </button>
      ))}
    </div>
  );
}

/** 人员选择字段（开关 + 单选人员），账单与自动记账共用。 */
export function PersonSelectField({
  checked,
  disabled,
  emptyText = "还没有人员，可到人员管理中添加",
  label = "人员",
  onCheckedChange,
  onValueChange,
  options,
  value,
}: PersonSelectFieldProps) {
  return (
    <ToggleCard checked={checked} disabled={disabled} label={label} onCheckedChange={onCheckedChange}>
      <PersonChipRow
        emptyText={emptyText}
        onValueChange={onValueChange}
        options={options}
        value={value}
      />
    </ToggleCard>
  );
}
