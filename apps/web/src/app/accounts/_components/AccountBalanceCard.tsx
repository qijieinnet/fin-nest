"use client";

import { useId, useMemo, useState } from "react";
import type { AccountEntry } from "@/lib/api";
import {
  COLOR_MONEY_NEGATIVE,
  COLOR_MONEY_POSITIVE,
  formatMoney,
  isLiability,
} from "./account-utils";
import { TrendRangeSelect, type TrendRange } from "./TrendRangeSelect";

type ChartPoint = { label: string; showLabel: boolean; valueMicros: bigint };

type AccountBalanceCardProps = {
  /** 账户/子账户图标 */
  icon: string;
  /** 主标题（账户名，子账户时可含父账户名） */
  name: string;
  /** 副标题（账户类型 / 子账户说明） */
  subtitle: string;
  /** 余额行的说明文案，如“账户余额”“已用额度” */
  balanceLabel: string;
  /** 展示用余额（可能已剔除不计入总资产的子账户） */
  balanceMicros: bigint | string;
  /** 余额数字颜色（CSS 变量或颜色值） */
  balanceColor?: string;
  /** 是否在余额前显示负号（负债类账户） */
  negativePrefix?: boolean;
  /** 用于重建曲线的“当前真实余额”，默认与 balanceMicros 相同 */
  currentBalanceMicros?: bigint | string;
  /** 账户类型，决定曲线涨跌的好坏配色 */
  accountType: string;
  /** 该范围（账户 / 子账户 / 默认桶）下的全部资金流水 */
  entries: AccountEntry[];
};

/**
 * 用每笔流水的 amountDeltaMicros 从“当前余额”反推历史余额。
 * 相比 balanceAfterMicros（只记账户总额），这样同样适用于子账户与默认桶。
 */
function makeBalanceResolver(entries: AccountEntry[], currentMicros: bigint) {
  const sorted = entries
    .map((entry) => ({
      time: new Date(entry.occurredAt).getTime(),
      delta: BigInt(entry.amountDeltaMicros),
    }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);

  if (sorted.length === 0) return () => currentMicros;
  const totalDelta = sorted.reduce((sum, item) => sum + item.delta, 0n);
  const startMicros = currentMicros - totalDelta;

  return (timeMs: number): bigint => {
    let result = startMicros;
    for (const item of sorted) {
      if (item.time <= timeMs) result += item.delta;
      else break;
    }
    return result;
  };
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildPoints(range: TrendRange, resolve: (timeMs: number) => bigint): ChartPoint[] {
  const now = new Date();
  const points: ChartPoint[] = [];

  if (range === "month6" || range === "year") {
    const count = range === "month6" ? 6 : 12;
    const anchor = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const monthStart = new Date(anchor.getFullYear(), anchor.getMonth() - offset, 1);
      // 取该月最后一刻（下月 1 号减 1ms），最后一格用“现在”反映实时余额。
      const boundary =
        offset === 0
          ? now.getTime()
          : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime() - 1;
      points.push({
        label: `${monthStart.getMonth() + 1}月`,
        showLabel: count <= 6 ? true : offset % 2 === 0,
        valueMicros: resolve(boundary),
      });
    }
    return points;
  }

  const days = range === "week" ? 7 : 30;
  const today = startOfDay(now);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const boundary =
      offset === 0
        ? now.getTime()
        : startOfDay(new Date(day.getTime() + 86_400_000)).getTime() - 1;
    const showLabel =
      range === "week" ? true : offset === days - 1 || offset === 0 || offset % 6 === 0;
    points.push({
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      showLabel,
      valueMicros: resolve(boundary),
    });
  }
  return points;
}

type Coord = { x: number; y: number };

/** Catmull-Rom 转三次贝塞尔，得到平滑曲线路径。 */
function smoothPath(coords: Coord[]): string {
  const first = coords[0];
  if (!first) return "";
  if (coords.length === 1) return `M ${first.x} ${first.y}`;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p1 = coords[i] as Coord;
    const p2 = coords[i + 1] as Coord;
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

const WIDTH = 320;
const HEIGHT = 120;
const PAD_X = 6;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

export function AccountBalanceCard({
  icon,
  name,
  subtitle,
  balanceLabel,
  balanceMicros,
  balanceColor = "var(--color-text-primary)",
  negativePrefix = false,
  currentBalanceMicros,
  accountType,
  entries,
}: AccountBalanceCardProps) {
  const [range, setRange] = useState<TrendRange>("month6");
  const gradientId = useId();
  const displayMicros = BigInt(balanceMicros);
  const current = BigInt(currentBalanceMicros ?? balanceMicros);
  const liability = isLiability(accountType);

  const points = useMemo(() => {
    const resolve = makeBalanceResolver(entries, current);
    return buildPoints(range, resolve);
  }, [range, entries, current]);

  const values = points.map((point) => point.valueMicros);
  const maxMicros = values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0n);
  const minMicros = values.reduce((min, value) => (value < min ? value : min), values[0] ?? 0n);
  const span = maxMicros - minMicros;

  const plotW = WIDTH - PAD_X * 2;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const coords = points.map((point, index) => {
    const x = points.length > 1 ? PAD_X + (index / (points.length - 1)) * plotW : WIDTH / 2;
    const ratio = span > 0n ? Number(((point.valueMicros - minMicros) * 1000n) / span) / 1000 : 0.5;
    const y = PAD_TOP + (1 - ratio) * plotH;
    return { x, y };
  });

  const line = smoothPath(coords);
  const baseY = HEIGHT - PAD_BOTTOM;
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  const area =
    firstCoord && lastCoord
      ? `${line} L ${lastCoord.x} ${baseY} L ${firstCoord.x} ${baseY} Z`
      : "";

  const startValue = values[0] ?? 0n;
  const deltaMicros = current - startValue;
  const deltaAbs = deltaMicros < 0n ? -deltaMicros : deltaMicros;
  // 账单约定：变好（资产增 / 负债减）红，变差绿。
  const favorable = liability ? deltaMicros <= 0n : deltaMicros >= 0n;
  const deltaColor = favorable ? COLOR_MONEY_POSITIVE : COLOR_MONEY_NEGATIVE;

  return (
    <section className="rounded-[20px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--color-control-fill-muted)] text-[24px]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
            {name}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-muted)]">{subtitle}</p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-[var(--color-text-muted)]">{balanceLabel}</p>
          <p
            className="mt-0.5 text-[32px] font-bold leading-tight tracking-tight [font-variant-numeric:tabular-nums]"
            style={{ color: balanceColor }}
          >
            {negativePrefix && displayMicros !== 0n ? "−" : ""}
            {formatMoney(displayMicros)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pb-0.5">
          <TrendRangeSelect onChange={setRange} value={range} />
          <p
            className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]"
            style={{ color: deltaColor }}
          >
            {deltaMicros === 0n ? "" : deltaMicros > 0n ? "+" : "−"}
            {formatMoney(deltaAbs)}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <svg
          aria-label="资金变动曲线"
          className="w-full"
          height={HEIGHT}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-tint)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--color-tint)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
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
            point.showLabel ? (
              <text
                fill="var(--color-text-muted)"
                fontSize="9"
                key={`${point.label}-${index}`}
                textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
                x={coords[index]?.x ?? 0}
                y={HEIGHT - 5}
              >
                {point.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </section>
  );
}
