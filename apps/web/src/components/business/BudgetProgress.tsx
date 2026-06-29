import { MoneyText } from "./MoneyText";

type BudgetProgressProps = {
  budgetMicros: bigint | number | string;
  label?: string;
  usedMicros: bigint | number | string;
};

export function BudgetProgress({ budgetMicros, label = "本月预算", usedMicros }: BudgetProgressProps) {
  const budget = BigInt(budgetMicros);
  const used = BigInt(usedMicros);
  const remaining = budget - used;
  const percent = budget > 0n ? Math.min(Number((used * 100n) / budget), 100) : 0;

  return (
    <div className="biz-budget-card">
      <div className="biz-budget-card__meta">
        <span>
          {label} <MoneyText amountMicros={budgetMicros} tone="muted" />
        </span>
        <span>
          剩余 <MoneyText amountMicros={remaining} tone={remaining < 0n ? "expense" : "muted"} />
        </span>
      </div>
      <span
        aria-label={`${label} 已使用 ${percent}%`}
        className="biz-budget-card__track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="biz-budget-card__bar" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
