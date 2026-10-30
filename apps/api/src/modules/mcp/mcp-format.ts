import { dateKey } from "@fin-nest/backend";
import { microsToYuan } from "../ai/ai-money";

/**
 * 给外部智能体阅读的结果格式化。
 *
 * 领域 service 返回的是库里的形状：金额是 micros（×1,000,000 的 bigint），日期是 Date。
 * 直接 JSON 化会让模型把 88500000 当成 8850 万，所以统一在出口处转换：
 * - `xxxMicros` 字段改名为 `xxx`，值为主单位十进制字符串（"88.5"）——换算在确定性代码里完成；
 * - `@db.Date` 列（Prisma 读出来是 UTC 零点的 Date）输出 `YYYY-MM-DD`，其余时间输出 ISO 字符串；
 * - 去掉 null/undefined 与对智能体无意义的内部列（审计字段、排序号等），节省上下文。
 */
const NOISE_KEYS = new Set([
  "ledgerId",
  "createdBy",
  "updatedBy",
  "deletedBy",
  "deletedAt",
  "updatedAt",
  "sortOrder",
  "relationPayload",
  "categorySnapshot",
  "personSnapshot",
]);

const MICROS_SUFFIX = /Micros$/;
const NUMERIC_STRING = /^-?\d+$/;

export function humanize(value: unknown, keepKeys: ReadonlySet<string> = new Set()): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return formatDate(value);
  if (Array.isArray(value)) return value.map((item) => humanize(item, keepKeys));
  if (typeof value !== "object") return value;
  // Prisma.Decimal 等带 toJSON 的值按其自身的序列化输出。
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key) && !keepKeys.has(key)) continue;
    if (raw === null || raw === undefined) continue;
    if (MICROS_SUFFIX.test(key) && isMicrosValue(raw)) {
      out[key.replace(MICROS_SUFFIX, "") || "amount"] = microsToYuan(BigInt(raw));
      continue;
    }
    const next = humanize(raw, keepKeys);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function isMicrosValue(value: unknown): value is bigint | string | number {
  if (typeof value === "bigint") return true;
  if (typeof value === "string") return NUMERIC_STRING.test(value);
  return typeof value === "number" && Number.isInteger(value);
}

function formatDate(value: Date): string {
  // date-only 列在 Prisma 里是 UTC 零点；真实时间戳恰好落在 UTC 零点的概率可以忽略。
  const isDateOnly =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
  return isDateOnly ? dateKey(value) : value.toISOString();
}

/** 统一的工具结果文本：bigint 先经 humanize 处理，这里只需 JSON 序列化。 */
export function toToolText(result: unknown): string {
  return JSON.stringify(humanize(result));
}
