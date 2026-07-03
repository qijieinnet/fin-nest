"use client";

import { BadgeDollarSign, CircleDollarSign, CreditCard } from "lucide-react";
import { Tabs } from "@/components/ui";
import type { TransactionType } from "./business-types";

type TransactionTypeSwitchProps = {
  onValueChange: (value: TransactionType) => void;
  value: TransactionType;
};

const transactionTypeItems = [
  { label: "支出", value: "expense", icon: <CircleDollarSign size={16} /> },
  { label: "收入", value: "income", icon: <BadgeDollarSign size={16} /> },
  { label: "转账", value: "transfer", icon: <CreditCard size={16} /> },
];

export function TransactionTypeSwitch({ onValueChange, value }: TransactionTypeSwitchProps) {
  return (
    <Tabs
      items={transactionTypeItems}
      onValueChange={(nextValue) => onValueChange(nextValue as TransactionType)}
      value={value}
    />
  );
}
