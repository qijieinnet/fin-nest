import { MoneyText } from "./MoneyText";

export type TrendPoint = {
  highlight?: boolean;
  label: string;
  valueMicros: bigint | number | string;
};

type TrendChartProps = {
  points: TrendPoint[];
  title?: string;
};

function absMicros(value: bigint | number | string): bigint {
  const micros = BigInt(value);
  return micros < 0n ? -micros : micros;
}

export function TrendChart({ points, title = "趋势" }: TrendChartProps) {
  const values = points.map((point) => absMicros(point.valueMicros));
  const max = values.reduce((current, next) => (next > current ? next : current), 0n);

  return (
    <div className="biz-chart">
      <div className="biz-section-header">
        <strong>{title}</strong>
      </div>
      <div className="biz-trend-chart">
        {points.map((point) => {
          const value = absMicros(point.valueMicros);
          const height = max > 0n ? Number((value * 100n) / max) : 0;
          return (
            <div className="biz-trend-chart__point" key={point.label}>
              <MoneyText amountMicros={point.valueMicros} tone="neutral" />
              <span
                className={point.highlight ? "biz-trend-chart__bar biz-trend-chart__bar--highlight" : "biz-trend-chart__bar"}
                style={{ height: `${Math.max(height, 8)}%` }}
              />
              <small>{point.label}</small>
            </div>
          );
        })}
      </div>
      {points.at(-1) ? (
        <MoneyText amountMicros={points.at(-1)?.valueMicros ?? "0"} tone="neutral" />
      ) : null}
    </div>
  );
}
