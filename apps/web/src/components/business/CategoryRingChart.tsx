import { CategoryIcon } from "./CategoryIcon";
import { MoneyText } from "./MoneyText";

export type CategoryRingSegment = {
  color: string;
  id?: string;
  icon?: string;
  label: string;
  valueMicros: bigint | number | string;
};

type CategoryRingChartProps = {
  onSegmentClick?: (segment: CategoryRingSegment) => void;
  segments: CategoryRingSegment[];
  title?: string;
};

function absMicros(value: bigint | number | string): bigint {
  const micros = BigInt(value);
  return micros < 0n ? -micros : micros;
}

export function CategoryRingChart({ onSegmentClick, segments, title = "分类占比" }: CategoryRingChartProps) {
  const total = segments.reduce((sum, item) => sum + absMicros(item.valueMicros), 0n);
  let cursor = 0;
  const gradient =
    total > 0n
      ? segments
          .map((segment) => {
            const start = cursor;
            const size = Number((absMicros(segment.valueMicros) * 10000n) / total) / 100;
            cursor += size;
            return `${segment.color} ${start}% ${cursor}%`;
          })
          .join(", ")
      : "rgba(120, 120, 128, 0.22) 0% 100%";

  return (
    <div className="biz-chart">
      <div className="biz-section-header">
        <strong>{title}</strong>
      </div>
      <div className="biz-ring-layout">
        <div className="biz-ring" style={{ background: `conic-gradient(${gradient})` }}>
          <span>{total > 0n ? "100%" : "0%"}</span>
        </div>
        <div className="biz-ring-list">
          {segments.map((segment) => (
            <button
              className="biz-ring-list__item"
              disabled={!onSegmentClick}
              key={segment.id ?? segment.label}
              onClick={() => onSegmentClick?.(segment)}
              type="button"
            >
              <CategoryIcon color={segment.color} icon={segment.icon} />
              <span>
                <strong>{segment.label}</strong>
                <MoneyText amountMicros={segment.valueMicros} tone="neutral" />
              </span>
              {onSegmentClick ? <em>›</em> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
