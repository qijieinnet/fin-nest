import { formatMicros } from "@/lib/money";
import { useDecimalPlaces } from "@/providers";

type PlanKind = "expense" | "income";

type PlanLimitCardProps = {
  endDate: string;
  kind?: PlanKind;
  limitMicros: bigint | number | string;
  name: string;
  referenceDate?: string;
  startDate: string;
  usedMicros: bigint | number | string;
};

const MICROS_PER_UNIT = 1_000_000n;

function todayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMicros(value: bigint | number | string): bigint {
  return BigInt(value);
}

function formatDateRange(startDate: string, endDate: string): string {
  return `${startDate} 至 ${endDate}`;
}

function formatStatMoney(valueMicros: bigint, decimalPlaces: number): string {
  const text = formatMicros(valueMicros, {
    currencySymbol: "",
    decimalPlaces,
    trimTrailingZeros: true,
  });

  return text.startsWith("-") ? `-${text.slice(1)}` : text;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;

  return Math.round((end - start) / 86_400_000);
}

export function PlanLimitCard({
  endDate,
  kind = "expense",
  limitMicros,
  name,
  referenceDate = todayDate(),
  startDate,
  usedMicros,
}: PlanLimitCardProps) {
  const decimalPlaces = useDecimalPlaces();
  const limit = toMicros(limitMicros);
  const used = toMicros(usedMicros);
  const remaining = limit > used ? limit - used : 0n;
  const over = used > limit ? used - limit : 0n;
  const percent = limit > 0n ? Number((used * 10_000n) / limit) / 100 : 0;
  const clampedPercent = Math.min(percent, 100);
  const elapsedDays = Math.max(
    1,
    Math.min(daysBetween(startDate, endDate) + 1, daysBetween(startDate, referenceDate) + 1),
  );
  const daysLeft = Math.max(0, daysBetween(referenceDate, endDate));
  const dailyMicros = used / BigInt(elapsedDays);
  const isIncome = kind === "income";

  const stats = [
    {
      label: isIncome ? "还差" : "剩余",
      primary: true,
      sub: ` / ${daysLeft}天`,
      value: formatStatMoney(remaining, decimalPlaces),
    },
    {
      label: isIncome ? "已收" : "已用",
      value: formatStatMoney(used, decimalPlaces),
    },
    // {
    //   label: "1D",
    //   value: (Number(dailyMicros) / Number(MICROS_PER_UNIT)).toFixed(2),
    // },
    {
      label: isIncome ? "超出" : "超过",
      value: formatStatMoney(over, decimalPlaces),
    },
  ];

  return (
    <div className="biz-plan-limit-card">
      <div className="biz-plan-limit-card__header">
        <strong>{name}</strong>
        <span className="biz-plan-limit-card__pct">
          <span className="biz-plan-limit-card__mini-track">
            <span
              className="biz-plan-limit-card__mini-bar"
              style={{ width: `${clampedPercent}%` }}
            />
          </span>
          <span>{percent.toFixed(2)}%</span>
        </span>
      </div>
      <div className="biz-plan-limit-card__limit">
        <span aria-hidden className="biz-plan-limit-card__face">
          <span />
          <span />
          <i />
        </span>
        限额 {formatMicros(limit, { decimalPlaces, trimTrailingZeros: true })}
      </div>
      <div className="biz-plan-limit-card__range">{formatDateRange(startDate, endDate)}</div>
      <div className="biz-plan-limit-card__stats">
        {stats.map((stat) => (
          <span className="biz-plan-limit-card__stat" key={stat.label}>
            <em className={stat.primary ? "biz-plan-limit-card__stat-label--primary" : undefined}>
              {stat.label}
            </em>
            <strong>
              {stat.value}
              {stat.sub ? <small>{stat.sub}</small> : null}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}
