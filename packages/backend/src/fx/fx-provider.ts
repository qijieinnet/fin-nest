import { formatFxRate, parseFxRate } from "@fin-nest/shared";

/**
 * 汇率数据源适配（目前只有 Frankfurter：欧洲央行参考汇率，免 key，可自建）。
 *
 * 这里只负责「发请求 + 解析」，不碰数据库；所有请求都有超时，失败抛错由调用方吞掉记日志——
 * 自部署常在内网 NAS 上，连不上外网是常态，绝不能让记账因为查不到汇率而失败。
 */

export const FRANKFURTER_DEFAULT_BASE_URL = "https://api.frankfurter.dev/v1";

/**
 * Frankfurter（ECB）支持的币种。目录里不在这里的（TWD、MOP）只能手填——
 * 请求它们只会拿到 404，提前过滤掉，免得每次都白打一次外网。
 */
export const FRANKFURTER_CURRENCIES = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "ZAR",
]);

export type ProviderRate = {
  from: string;
  to: string;
  /** 数据源给出的汇率日期（YYYY-MM-DD）；周末/节假日请求会落到之前最近的交易日。 */
  date: string;
  /** 十进制字符串，最多 10 位小数。 */
  rate: string;
};

const REQUEST_TIMEOUT_MS = 5_000;

export class FrankfurterProvider {
  readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? FRANKFURTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  supports(from: string, to: string): boolean {
    return FRANKFURTER_CURRENCIES.has(from) && FRANKFURTER_CURRENCIES.has(to) && from !== to;
  }

  /** 某一天（或 latest）的 from→to 汇率。 */
  async fetchOn(from: string, toList: string[], date: string | "latest"): Promise<ProviderRate[]> {
    const targets = toList.filter((to) => this.supports(from, to));
    if (targets.length === 0) return [];
    const url = `${this.baseUrl}/${date}?base=${encodeURIComponent(from)}&symbols=${targets.map(encodeURIComponent).join(",")}`;
    const body = (await this.getJson(url)) as { date?: unknown; rates?: Record<string, unknown> };
    const rateDate = typeof body.date === "string" ? body.date : null;
    if (!rateDate || !body.rates) return [];
    return targets.flatMap((to) => {
      const rate = normalizeRate(body.rates?.[to]);
      return rate ? [{ from, to, date: rateDate, rate }] : [];
    });
  }

  /** 区间内每个交易日的 from→to 汇率（净资产曲线补历史用）。 */
  async fetchRange(from: string, to: string, start: string, end: string): Promise<ProviderRate[]> {
    if (!this.supports(from, to)) return [];
    const url = `${this.baseUrl}/${start}..${end}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const body = (await this.getJson(url)) as { rates?: Record<string, Record<string, unknown>> };
    if (!body.rates) return [];
    return Object.entries(body.rates).flatMap(([date, rates]) => {
      const rate = normalizeRate(rates?.[to]);
      return rate && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [{ from, to, date, rate }] : [];
    });
  }

  private async getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`汇率数据源返回 HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 数据源给的是 JSON number；转成定点再转回字符串，顺带丢掉非法值与指数写法。 */
function normalizeRate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // toFixed 只用于把 number 变成十进制字符串（不是金额运算），之后全程定点 bigint。
  const scaled = parseFxRate(value.toFixed(10));
  return scaled ? formatFxRate(scaled) : null;
}
