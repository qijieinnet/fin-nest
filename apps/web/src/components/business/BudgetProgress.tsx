import { PlanProgress } from "./PlanProgress";

type BudgetProgressProps = {
  budgetMicros: bigint | number | string;
  label?: string;
  usedMicros: bigint | number | string;
};

export function BudgetProgress({ budgetMicros, label = "本月预算", usedMicros }: BudgetProgressProps) {
  return <PlanProgress label={label} targetMicros={budgetMicros} usedMicros={usedMicros} />;
}

