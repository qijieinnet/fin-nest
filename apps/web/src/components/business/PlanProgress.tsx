import { MoneyText } from "./MoneyText";

type PlanProgressProps = {
  label: string;
  targetMicros: bigint | number | string;
  usedMicros: bigint | number | string;
};

export function PlanProgress({ label, targetMicros, usedMicros }: PlanProgressProps) {
  const target = BigInt(targetMicros);
  const used = BigInt(usedMicros);
  const percent = target > 0n ? Math.min(Number((used * 100n) / target), 999) : 0;

  return (
    <div className="biz-progress">
      <div className="biz-section-header">
        <strong>{label}</strong>
        <span>{percent}%</span>
      </div>
      <span className="biz-progress__track">
        <span className="biz-progress__bar" style={{ width: `${Math.min(percent, 100)}%` }} />
      </span>
      <div className="biz-progress__meta">
        <MoneyText amountMicros={usedMicros} tone="expense" />
        <MoneyText amountMicros={targetMicros} tone="muted" />
      </div>
    </div>
  );
}

