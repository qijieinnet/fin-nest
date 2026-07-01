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
      {options.length > 0 ? (
        <div className="transaction-form__people-row">
          {options.map((person) => {
            const selected = person.id === value;
            return (
              <button
                className={cn("transaction-form__chip", selected && "transaction-form__chip--selected")}
                key={person.id}
                onClick={() => onValueChange(person.id)}
                type="button"
              >
                {person.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="transaction-form__empty-text">{emptyText}</p>
      )}
    </ToggleCard>
  );
}
