"use client";

import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui";

type MonthWheelPickerProps = {
  label?: string;
  onValueChange: (value: string) => void;
  value: string;
};

export function MonthWheelPicker({ label = "月份", onValueChange, value }: MonthWheelPickerProps) {
  return (
    <div className="biz-date-picker">
      <CalendarRange size={20} />
      <Input
        label={label}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        type="month"
        value={value}
      />
    </div>
  );
}

