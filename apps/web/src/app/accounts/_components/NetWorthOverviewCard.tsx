"use client";

import { useState } from "react";
import { MoneyText } from "@/components/business";
import { formatMicros } from "@/lib/money";
import { useNetWorthSeries } from "@/lib/data/records";
import { useLedger } from "@/providers";
import { COLOR_MONEY_NEGATIVE, COLOR_MONEY_POSITIVE } from "./account-utils";
import { TrendRangeSelect, type TrendRange } from "./TrendRangeSelect";

const WIDTH = 320;
const HEIGHT = 96;
const PAD_X = 4;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

function smoothPath(coords: Array<{ x: number; y: number }>): string {
  const first = coords[0];
  if (!first) return "";
  if (coords.length === 1) return `M ${first.x} ${first.y}`;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p1 = coords[i]!;
    const p2 = coords[i + 1]!;
    const p0 = coords[i - 1] ?? p1;
    const p3 = coords[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return path;
}

/** 点数较多时（如近1个月的每日点）稀释 x 轴标签，只保留首尾与等距若干。 */
function shouldShowLabel(index: number, count: number): boolean {
  if (count <= 8) return true;
  const step = Math.ceil(count / 6);
  return index === 0 || index === count - 1 || index % step === 0;
}

type NetWorthOverviewCardProps = {
  netMicros: bigint;
  assetsMicros: bigint;
  liabilitiesMicros: bigint;
  decimalPlaces: number;
};

export function NetWorthOverviewCard({
  netMicros,
  assetsMicros,
  liabilitiesMicros,
  decimalPlaces,
}: NetWorthOverviewCardProps) {
  const { ledgerId } = useLedger();
  const [range, setRange] = useState<TrendRange>("month6");
  const seriesQuery = useNetWorthSeries(ledgerId, range);
  const points = (seriesQuery.data?.points ?? []).map((point) => ({
    label: point.label,
    valueMicros: BigInt(point.netWorthMicros),
  }));

  const values = points.map((point) => point.valueMicros);
  const max = values.reduce((acc, value) => (value > acc ? value : acc), values[0] ?? 0n);
  const min = values.reduce((acc, value) => (value < acc ? value : acc), values[0] ?? 0n);
  const span = max - min;

  const plotW = WIDTH - PAD_X * 2;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const coords = points.map((point, index) => {
    const x = points.length > 1 ? PAD_X + (index / (points.length - 1)) * plotW : WIDTH / 2;
    const ratio = span > 0n ? Number(((point.valueMicros - min) * 1000n) / span) / 1000 : 0.5;
    return { x, y: PAD_TOP + (1 - ratio) * plotH };
  });
  const line = smoothPath(coords);
  const baseY = HEIGHT - PAD_BOTTOM;
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  const area =
    firstCoord && lastCoord
      ? `${line} L ${lastCoord.x} ${baseY} L ${firstCoord.x} ${baseY} Z`
      : "";

  const startValue = values[0] ?? netMicros;
  const delta = netMicros - startValue;
  const deltaAbs = delta < 0n ? -delta : delta;
  // 账单约定：净资产上升（正）红、下降（负）绿。
  const deltaColor = delta >= 0n ? COLOR_MONEY_POSITIVE : COLOR_MONEY_NEGATIVE;
  const hasTrend = points.length > 1;

  return (
    <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">净资产</p>
          <p className="mt-1.5 flex items-baseline gap-0.5">
            <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">¥</span>
            <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatMicros(netMicros, { currencySymbol: "", decimalPlaces })}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <TrendRangeSelect onChange={setRange} value={range} />
          {hasTrend ? (
            <p
              className="text-[12.5px] font-semibold [font-variant-numeric:tabular-nums]"
              style={{ color: deltaColor }}
            >
              {delta === 0n ? "" : delta > 0n ? "+" : "−"}
              {formatMicros(deltaAbs, {
                currencySymbol: "¥",
                decimalPlaces,
                trimTrailingZeros: true,
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3.5 flex gap-7">
        <div>
          <p className="text-[11px] text-[var(--color-text-muted)]">总资产</p>
          <MoneyText
            amountMicros={assetsMicros}
            className="mt-0.5 block text-[15px] font-semibold"
            tone="neutral"
          />
        </div>
        <div>
          <p className="text-[11px] text-[var(--color-text-muted)]">总负债</p>
          <MoneyText
            amountMicros={liabilitiesMicros}
            className="mt-0.5 block text-[15px] font-semibold"
            style={{ color: COLOR_MONEY_NEGATIVE }}
            tone="neutral"
          />
        </div>
      </div>

      {hasTrend ? (
        <svg
          aria-label="净资产走势"
          className="mt-4 w-full"
          height={HEIGHT}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <linearGradient id="net-worth-overview-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-tint)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--color-tint)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area ? <path d={area} fill="url(#net-worth-overview-gradient)" /> : null}
          {line ? (
            <path
              d={line}
              fill="none"
              stroke="var(--color-tint)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {lastCoord ? (
            <circle cx={lastCoord.x} cy={lastCoord.y} fill="var(--color-tint)" r={3} />
          ) : null}
          {points.map((point, index) =>
            shouldShowLabel(index, points.length) ? (
              <text
                fill="var(--color-text-muted)"
                fontSize="9"
                key={`${point.label}-${index}`}
                textAnchor={
                  index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
                }
                x={coords[index]?.x ?? 0}
                y={HEIGHT - 4}
              >
                {point.label}
              </text>
            ) : null,
          )}
        </svg>
      ) : null}
    </section>
  );
}
