"use client";

import { UserRound } from "lucide-react";
import { SelectField } from "@/components/ui";
import type { BusinessOption } from "./business-types";

type PersonPickerProps = {
  label?: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  value: string | null;
};

export function PersonPicker({ label = "人员", onValueChange, options, value }: PersonPickerProps) {
  return (
    <SelectField
      clearable
      icon={<UserRound size={20} />}
      label={label}
      onValueChange={(nextValue) => onValueChange(nextValue || null)}
      options={options.map((option) => ({ label: option.label, value: option.id }))}
      placeholder="选择人员"
      value={value ?? ""}
    />
  );
}
