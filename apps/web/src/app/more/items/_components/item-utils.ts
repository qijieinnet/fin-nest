import type { ItemAsset, ItemType, Transaction } from "@/lib/api";
import { formatMicros } from "@/lib/money";

/** 常用物品类型的推荐图标，未匹配的自定义类型用兜底图标。 */
export const ITEM_TYPE_ICONS: Record<string, string> = {
  数码: "💻",
  家电: "🔌",
  家具: "🛋️",
  交通: "🚲",
  服饰: "👕",
  运动: "🏀",
  母婴: "🍼",
  美妆: "💄",
  图书: "📚",
  其他: "📦",
};

export const ITEM_TYPE_PRESETS = Object.keys(ITEM_TYPE_ICONS);

export function itemTypeIcon(typeName: string | null | undefined): string {
  return (typeName && ITEM_TYPE_ICONS[typeName]) || "📦";
}

/** 类型展示图标：优先用类型自定义 icon，否则按名称回退到推荐图标。 */
export function typeGlyph(type: Pick<ItemType, "name" | "icon"> | null | undefined): string {
  return type?.icon || itemTypeIcon(type?.name);
}

export function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 使用时长统计截止日：已报废按报废日，在用按今天。 */
function usageEndKey(item: Pick<ItemAsset, "scrappedAt" | "scrapDate">): string {
  if (item.scrappedAt) return item.scrapDate?.slice(0, 10) ?? todayKey();
  return todayKey();
}

export function itemUsedDays(
  item: Pick<ItemAsset, "purchaseDate" | "scrappedAt" | "scrapDate">,
): number {
  if (!item.purchaseDate) return 0;
  const start = Date.parse(item.purchaseDate.slice(0, 10));
  const end = Date.parse(usageEndKey(item));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function itemUsedYears(
  item: Pick<ItemAsset, "purchaseDate" | "scrappedAt" | "scrapDate">,
): number {
  return itemUsedDays(item) / 365;
}

export function itemUsedMonths(
  item: Pick<ItemAsset, "purchaseDate" | "scrappedAt" | "scrapDate">,
): number {
  return itemUsedDays(item) / 30.4375;
}

export function itemReached(
  item: Pick<ItemAsset, "purchaseDate" | "scrappedAt" | "scrapDate" | "expectedYears">,
): boolean {
  const expected = Number(item.expectedYears ?? 0);
  return expected > 0 && itemUsedYears(item) >= expected;
}

export type ItemStatus = {
  key: "active" | "reached" | "scrapped";
  label: string;
  tone: "active" | "reached" | "scrapped";
};

export function itemStatus(
  item: Pick<ItemAsset, "purchaseDate" | "scrappedAt" | "scrapDate" | "expectedYears">,
): ItemStatus {
  if (item.scrappedAt) return { key: "scrapped", label: "已报废", tone: "scrapped" };
  if (itemReached(item)) return { key: "reached", label: "到达年限", tone: "reached" };
  return { key: "active", label: "在用", tone: "active" };
}

/** 耗材合计（微单位）：关联支出累加、关联收入抵减，与后端列表口径一致。 */
export function consumablesFromTransactions(transactions: Transaction[]): bigint {
  return transactions.reduce((sum, tx) => {
    if (tx.type === "expense") return sum + BigInt(tx.effectiveAmountMicros);
    if (tx.type === "income") return sum - BigInt(tx.effectiveAmountMicros);
    return sum;
  }, 0n);
}

/** 物品总价（微单位）= 购买价格 + 耗材合计。 */
export function itemTotalMicros(
  item: Pick<ItemAsset, "purchasePriceMicros">,
  consumablesMicros: bigint,
): bigint {
  return BigInt(item.purchasePriceMicros ?? "0") + consumablesMicros;
}

export function formatMoney(micros: bigint | string | null | undefined): string {
  if (micros === null || micros === undefined) return "—";
  return formatMicros(typeof micros === "bigint" ? micros.toString() : micros, {
    trimTrailingZeros: true,
  });
}

/** 把微单位金额转成输入框用的普通字符串（无货币符号、无千分位）。 */
export function microsToInput(micros: string | null | undefined): string {
  if (!micros) return "";
  const value = BigInt(micros);
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n) / 10_000n;
  return fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}

/** 保留 1 位小数的年限/月数文本。 */
export function formatFixed1(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

/** 平均年价/月价：不足 1 个统计周期时，按 1 个周期摊销，避免短期年化/月化失真。 */
export function formatAverage(totalMicros: bigint, spans: number): string {
  if (!Number.isFinite(spans) || spans < 0) return "—";
  const divisor = Math.max(1, spans);
  const yuan = Number(totalMicros) / 1_000_000;
  return `¥${(yuan / divisor).toFixed(1)}`;
}
