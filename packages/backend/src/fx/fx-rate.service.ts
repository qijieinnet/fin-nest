import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "@fin-nest/config";
import { Prisma } from "@fin-nest/db";
import {
  convertMicros,
  FX_RATE_SCALE,
  formatFxRate,
  invertFxRate,
  isSupportedCurrency,
  parseFxRate,
  roundMicrosToCurrency,
} from "@fin-nest/shared";
import { dateKey, parseDateOnly, todayKey } from "../dates/date-only";
import { PrismaService } from "../prisma/prisma.service";
import type { PrismaTransactionClient } from "../transactions/database-transaction.service";
import { FrankfurterProvider, type ProviderRate } from "./fx-provider";

/**
 * 汇率查询与缓存（多币种方案 §4）。
 *
 * 汇率表 `exchange_rates`：ledgerId 为空 = 数据源抓取的全局行；非空 = 该账本手填，优先于自动。
 * 查询口径：取 `rate_date <= date` 最近的一条（同一天手填优先、正向优先于反向）；没有时只接受
 * `FUTURE_TOLERANCE_DAYS` 天内的下一条，再没有就是缺汇率。启用了数据源时，最近一条离目标日期太远
 * （或根本没有）会先向数据源补一次；两个外币之间经账本本币交叉。
 */

export type FxSource = "identity" | "manual" | "frankfurter";

export type FxQuote = {
  from: string;
  to: string;
  /** 汇率实际对应的日期（YYYY-MM-DD）；identity 时等于请求日期。 */
  date: string;
  /** 1 from = rate to，十进制字符串。 */
  rate: string;
  rateScaled: bigint;
  source: FxSource;
};

type RateRow = {
  ledgerId: string | null;
  fromCurrency: string;
  toCurrency: string;
  rateDate: Date;
  rate: Prisma.Decimal;
  source: string;
};

type Client = PrismaTransactionClient | PrismaService["client"];

/** 最近一条汇率比目标日期早超过这么多天，就认为「过时」，启用数据源时先补一次。 */
const STALE_DAYS = 4;
/** 同一个请求失败后多久内不再重试（进程内记忆），免得数据源挂了时每次记账都多等 5 秒。 */
const RETRY_AFTER_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;
/**
 * 目标日期及之前没有汇率时，最多接受晚这么多天的汇率（周末/节假日、手填日期比交易晚一两天）。
 * 再晚就当缺汇率：拿几个月后的汇率去折算过去的金额是错的，宁可让用户补录。
 */
const FUTURE_TOLERANCE_DAYS = 7;

function decimalText(value: Prisma.Decimal | string | number): string {
  return typeof value === "object" && value !== null && "toFixed" in value
    ? value.toFixed()
    : String(value);
}

/** 舍入到 places 位小数（半进位，远离零）。 */
function roundMicrosToPlaces(micros: bigint, places: number): bigint {
  const step = 10n ** BigInt(6 - Math.min(Math.max(places, 0), 6));
  if (step === 1n) return micros;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs * 2n + step) / (step * 2n)) * step;
  return negative ? -rounded : rounded;
}

function addDays(key: string, days: number): string {
  return dateKey(new Date(parseDateOnly(key).getTime() + days * DAY_MS));
}

/**
 * 一组币种在一段时间内的汇率表（都折到同一个目标币种），净资产曲线逐点取值用。
 * `rateAt` 取 `<= date` 最近的一条；没有时只接受 `FUTURE_TOLERANCE_DAYS` 天内的下一条，
 * 再没有就返回 null（缺汇率）。
 */
export class FxRateTable {
  constructor(
    readonly to: string,
    private readonly series: Map<string, Array<{ date: string; rateScaled: bigint }>>,
  ) {}

  rateAt(currency: string, date: string): bigint | null {
    if (currency === this.to) return 10_000_000_000n;
    const points = this.series.get(currency);
    if (!points || points.length === 0) return null;
    let found: bigint | null = null;
    for (const point of points) {
      if (point.date <= date) found = point.rateScaled;
      else break;
    }
    if (found !== null) return found;
    const next = points[0]!;
    return next.date <= addDays(date, FUTURE_TOLERANCE_DAYS) ? next.rateScaled : null;
  }

  /** 折算；该币种没有任何汇率时返回 null。 */
  convert(amountMicros: bigint, currency: string, date: string): bigint | null {
    if (currency === this.to) return amountMicros;
    const rate = this.rateAt(currency, date);
    return rate === null ? null : convertMicros(amountMicros, rate);
  }

  has(currency: string): boolean {
    return currency === this.to || (this.series.get(currency)?.length ?? 0) > 0;
  }
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private readonly config = loadConfig();
  private readonly provider: FrankfurterProvider | null =
    this.config.FX_PROVIDER === "frankfurter"
      ? new FrankfurterProvider(this.config.FX_BASE_URL)
      : null;
  /** 失败的数据源请求 → 失败时间，用于退避。 */
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  get providerEnabled(): boolean {
    return this.provider !== null;
  }

  get providerName(): string | null {
    return this.provider ? "frankfurter" : null;
  }

  /** 数据源能否提供这对币种（不能的只能手填）。 */
  providerSupports(from: string, to: string): boolean {
    return this.provider?.supports(from, to) ?? false;
  }

  /**
   * 查 from→to 在 date 的汇率。`fetchIfStale` 为 true（默认）且启用了数据源时，
   * 缺失或过时会先向数据源补取一次（失败吞掉，退回库里已有的）。
   */
  async findRate(
    ledgerId: string,
    from: string,
    to: string,
    date: string = todayKey(),
    options: { fetchIfStale?: boolean; client?: Client } = {},
  ): Promise<FxQuote | null> {
    if (from === to) {
      return { from, to, date, rate: "1", rateScaled: 10_000_000_000n, source: "identity" };
    }
    const client = options.client ?? this.prisma.client;
    const direct = await this.findDirectRate(client, ledgerId, from, to, date, options);
    if (direct) return direct;
    // 两个外币之间（USD→HKD）通常只录了各自对本币的汇率：经账本本币交叉换算。
    const ledger = await client.ledger.findFirst({
      where: { id: ledgerId },
      select: { currency: true },
    });
    const pivot = ledger?.currency;
    if (!pivot || pivot === from || pivot === to) return null;
    // 两条腿都取「X→本币」再相除：汇率通常就是这么存的（外币→本币），
    // 先取倒数再相乘会多丢一次精度（7 ÷ 0.9 算成 7.7777777777）。
    const leg1 = await this.findDirectRate(client, ledgerId, from, pivot, date, options);
    const leg2 = leg1
      ? await this.findDirectRate(client, ledgerId, to, pivot, date, options)
      : null;
    if (!leg1 || !leg2 || leg2.rateScaled <= 0n) return null;
    const rateScaled =
      (leg1.rateScaled * FX_RATE_SCALE * 2n + leg2.rateScaled) / (leg2.rateScaled * 2n);
    if (rateScaled <= 0n) return null;
    return {
      from,
      to,
      // 交叉汇率取两条腿里较旧的日期，展示时不至于把过时的一腿说成「当天」。
      date: leg1.date < leg2.date ? leg1.date : leg2.date,
      rate: formatFxRate(rateScaled),
      rateScaled,
      source: leg1.source === "manual" || leg2.source === "manual" ? "manual" : leg1.source,
    };
  }

  /** 只看 from↔to 这一对（正向或反向），必要时向数据源补取；不做交叉换算。 */
  private async findDirectRate(
    client: Client,
    ledgerId: string,
    from: string,
    to: string,
    date: string,
    options: { fetchIfStale?: boolean },
  ): Promise<FxQuote | null> {
    let quote = await this.lookup(client, ledgerId, from, to, date);
    const stale =
      !quote ||
      quote.date > date ||
      parseDateOnly(date).getTime() - parseDateOnly(quote.date).getTime() > STALE_DAYS * DAY_MS;
    // 数据源只有「今天及以前」的汇率；未来日期按最新的算，不去请求。
    const requestDate = date > todayKey() ? todayKey() : date;
    if (stale && options.fetchIfStale !== false) {
      const fetched = await this.fetchAndStore([{ from, to }], requestDate);
      if (fetched > 0) quote = await this.lookup(client, ledgerId, from, to, date);
    }
    return quote;
  }

  /**
   * 按 date 的汇率把 from 币种金额折成 to 币种，并舍入到 to 币种的最小单位（如分）——
   * 折算结果要落库成交易/待确认金额，不能带着 0.000412 元的尾巴。取不到汇率返回 null。
   */
  async convert(
    ledgerId: string,
    amountMicros: bigint,
    from: string,
    to: string,
    date?: string,
    options?: {
      fetchIfStale?: boolean;
      client?: Client;
      /**
       * 舍入到的小数位；不传按 to 币种的常用位数（JPY 0、USD 2）。
       * 折成账本本币时要传账本的金额小数位，只舍入这一次——先按币种再按账本舍入会二次舍入出错
       * （0 位小数账本里 $1 × 7.499 先成 7.50 再成 8，正确应为 7）。
       */
      decimalPlaces?: number;
    },
  ): Promise<{ amountMicros: bigint; quote: FxQuote } | null> {
    const quote = await this.findRate(ledgerId, from, to, date, options);
    if (!quote) return null;
    const raw = convertMicros(amountMicros, quote.rateScaled);
    return {
      amountMicros:
        options?.decimalPlaces === undefined
          ? roundMicrosToCurrency(raw, to)
          : roundMicrosToPlaces(raw, options.decimalPlaces),
      quote,
    };
  }

  /**
   * 净资产曲线用：一次取出若干币种在 [start, end] 的汇率（含 start 之前最近的一条），折到 `to`。
   * `backfill` 时，区间内缺历史且数据源支持的币种会用一次区间请求补齐。
   */
  async loadTable(
    ledgerId: string,
    currencies: Iterable<string>,
    to: string,
    start: string,
    end: string,
    options: { backfill?: boolean } = {},
  ): Promise<FxRateTable> {
    const wanted = [...new Set(currencies)].filter((currency) => currency !== to);
    const series = new Map<string, Array<{ date: string; rateScaled: bigint }>>();
    if (wanted.length === 0) return new FxRateTable(to, series);

    if (options.backfill && this.provider) {
      await this.backfillRange(ledgerId, wanted, to, start, end);
    }

    const rows = await this.prisma.client.exchangeRate.findMany({
      where: {
        OR: [{ ledgerId }, { ledgerId: null }],
        AND: [
          {
            OR: [
              { fromCurrency: { in: wanted }, toCurrency: to },
              { fromCurrency: to, toCurrency: { in: wanted } },
            ],
          },
        ],
        // 多取容差天数：区间末尾之前没有汇率时，rateAt 要能用上几天内的下一条（与 findRate 同口径）。
        rateDate: { lte: parseDateOnly(addDays(end, FUTURE_TOLERANCE_DAYS)) },
      },
      orderBy: { rateDate: "asc" },
    });
    // 同一天可能有手填 + 自动、正向 + 反向，按「手填 > 自动、正向 > 反向」只留一条。
    const best = new Map<string, { date: string; rateScaled: bigint; rank: number }>();
    for (const row of rows) {
      const direct = row.fromCurrency !== to;
      const currency = direct ? row.fromCurrency : row.toCurrency;
      const parsed = parseFxRate(decimalText(row.rate));
      if (!parsed) continue;
      const rateScaled = direct ? parsed : invertFxRate(parsed);
      const rank = (row.ledgerId ? 2 : 0) + (direct ? 1 : 0);
      const date = dateKey(row.rateDate);
      const key = `${currency}:${date}`;
      const existing = best.get(key);
      if (!existing || rank > existing.rank) best.set(key, { date, rateScaled, rank });
    }
    for (const [key, value] of best) {
      const currency = key.slice(0, 3);
      const list = series.get(currency) ?? [];
      list.push({ date: value.date, rateScaled: value.rateScaled });
      series.set(currency, list);
    }
    for (const list of series.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));
    // 只保留 start 之前最近的一条 + 区间内的，丢掉更早的历史，减少逐点扫描量。
    for (const [currency, list] of series) {
      const firstInRange = list.findIndex((point) => point.date >= start);
      const keepFrom = firstInRange === -1 ? list.length - 1 : Math.max(0, firstInRange - 1);
      series.set(currency, list.slice(keepFrom));
    }
    return new FxRateTable(to, series);
  }

  /**
   * Worker 每日调用：把各账本在用的外币刷新到最新汇率。
   * 返回写入行数（同一天已存在的会被覆盖为数据源的最新值）与失败的请求数。
   */
  async refreshLatestInUse(): Promise<{ written: number; failed: number }> {
    if (!this.provider) return { written: 0, failed: 0 };
    const pairs = await this.pairsInUse();
    const byFrom = new Map<string, Set<string>>();
    for (const { from, to } of pairs) {
      if (!this.provider.supports(from, to)) continue;
      const set = byFrom.get(from) ?? new Set<string>();
      set.add(to);
      byFrom.set(from, set);
    }
    let written = 0;
    let failed = 0;
    for (const [from, targets] of byFrom) {
      try {
        const rates = await this.provider.fetchOn(from, [...targets], "latest");
        written += await this.storeProviderRates(rates);
      } catch (error) {
        failed += 1;
        this.logger.warn(`刷新汇率失败 ${from}→${[...targets].join(",")}: ${String(error)}`);
      }
    }
    return { written, failed };
  }

  /** 手填 / 覆盖某账本某天的汇率（1 from = rate to）。 */
  async upsertManual(
    client: Client,
    input: {
      ledgerId: string;
      from: string;
      to: string;
      date: string;
      rate: string;
      userId: string;
    },
  ) {
    const rateScaled = parseFxRate(input.rate);
    if (!rateScaled) throw new Error("invalid rate");
    const rate = formatFxRate(rateScaled);
    const rateDate = parseDateOnly(input.date);
    const existing = await client.exchangeRate.findFirst({
      where: {
        ledgerId: input.ledgerId,
        fromCurrency: input.from,
        toCurrency: input.to,
        rateDate,
      },
    });
    if (existing) {
      return client.exchangeRate.update({
        where: { id: existing.id },
        data: { rate: new Prisma.Decimal(rate), createdBy: input.userId },
      });
    }
    return client.exchangeRate.create({
      data: {
        ledgerId: input.ledgerId,
        fromCurrency: input.from,
        toCurrency: input.to,
        rateDate,
        rate: new Prisma.Decimal(rate),
        source: "manual",
        createdBy: input.userId,
      },
    });
  }

  // ---------------------------------------------------------------------------

  private async lookup(
    client: Client,
    ledgerId: string,
    from: string,
    to: string,
    date: string,
  ): Promise<FxQuote | null> {
    const pairWhere = {
      OR: [
        { fromCurrency: from, toCurrency: to },
        { fromCurrency: to, toCurrency: from },
      ],
    };
    const scope = { OR: [{ ledgerId }, { ledgerId: null }] };
    const target = parseDateOnly(date);
    const before = await client.exchangeRate.findMany({
      where: { AND: [scope, pairWhere], rateDate: { lte: target } },
      orderBy: { rateDate: "desc" },
      take: 4,
    });
    const candidates = before.length
      ? before
      : await client.exchangeRate.findMany({
          where: {
            AND: [scope, pairWhere],
            rateDate: {
              gt: target,
              lte: parseDateOnly(addDays(date, FUTURE_TOLERANCE_DAYS)),
            },
          },
          orderBy: { rateDate: "asc" },
          take: 4,
        });
    if (candidates.length === 0) return null;
    const topDate = dateKey(candidates[0]!.rateDate);
    const sameDay = candidates.filter((row) => dateKey(row.rateDate) === topDate);
    sameDay.sort((a, b) => this.rank(b, from) - this.rank(a, from));
    return this.toQuote(sameDay[0]!, from, to);
  }

  private rank(row: RateRow, from: string): number {
    return (row.ledgerId ? 2 : 0) + (row.fromCurrency === from ? 1 : 0);
  }

  private toQuote(row: RateRow, from: string, to: string): FxQuote | null {
    const parsed = parseFxRate(decimalText(row.rate));
    if (!parsed) return null;
    const rateScaled = row.fromCurrency === from ? parsed : invertFxRate(parsed);
    return {
      from,
      to,
      date: dateKey(row.rateDate),
      rate: formatFxRate(rateScaled),
      rateScaled,
      source: row.ledgerId ? "manual" : (row.source as FxSource),
    };
  }

  /** 向数据源取某天的汇率并入库；返回写入行数。失败吞掉并退避。 */
  private async fetchAndStore(pairs: Array<{ from: string; to: string }>, date: string) {
    if (!this.provider) return 0;
    let written = 0;
    for (const { from, to } of pairs) {
      if (!this.provider.supports(from, to)) continue;
      const key = `on:${from}:${to}:${date}`;
      if (this.recentlyFailed(key)) continue;
      try {
        const rates = await this.provider.fetchOn(from, [to], date);
        written += await this.storeProviderRates(rates);
        // 数据源有回应但没有这一天（比如今天的汇率还没发布）：同样退避，别每笔记账都去问一次。
        if (!rates.some((rate) => rate.date === date)) this.failedAt.set(key, Date.now());
      } catch (error) {
        this.failedAt.set(key, Date.now());
        this.logger.warn(`获取汇率失败 ${from}→${to}@${date}: ${String(error)}`);
      }
    }
    return written;
  }

  private async backfillRange(
    ledgerId: string,
    currencies: string[],
    to: string,
    start: string,
    end: string,
  ) {
    if (!this.provider) return;
    const today = todayKey();
    const rangeEnd = end > today ? today : end;
    if (start > rangeEnd) return;
    for (const currency of currencies) {
      if (!this.provider.supports(currency, to)) continue;
      // 区间内已经有足够密的数据（首条不晚于 start 之后 STALE_DAYS 天）就不再请求。
      const first = await this.prisma.client.exchangeRate.findFirst({
        where: {
          OR: [{ ledgerId }, { ledgerId: null }],
          AND: [
            {
              OR: [
                { fromCurrency: currency, toCurrency: to },
                { fromCurrency: to, toCurrency: currency },
              ],
            },
          ],
          rateDate: { lte: parseDateOnly(addDays(start, STALE_DAYS)) },
        },
        orderBy: { rateDate: "desc" },
      });
      // 只看本账本手填 + 全局行：别的账本的手填汇率不能让本账本误判成「已覆盖」。
      const last = await this.prisma.client.exchangeRate.findFirst({
        where: {
          OR: [{ ledgerId }, { ledgerId: null }],
          AND: [
            {
              OR: [
                { fromCurrency: currency, toCurrency: to },
                { fromCurrency: to, toCurrency: currency },
              ],
            },
          ],
          rateDate: { lte: parseDateOnly(rangeEnd) },
        },
        orderBy: { rateDate: "desc" },
      });
      const covered =
        first &&
        dateKey(first.rateDate) >= addDays(start, -STALE_DAYS) &&
        last &&
        dateKey(last.rateDate) >= addDays(rangeEnd, -STALE_DAYS);
      if (covered) continue;
      const key = `range:${currency}:${to}:${start}:${rangeEnd}`;
      if (this.recentlyFailed(key)) continue;
      try {
        const rates = await this.provider.fetchRange(currency, to, start, rangeEnd);
        await this.storeProviderRates(rates);
        // 成功也记一次：同一区间一小时内不再重复请求（周末/节假日本来就没有数据）。
        this.failedAt.set(key, Date.now());
      } catch (error) {
        this.failedAt.set(key, Date.now());
        this.logger.warn(
          `补历史汇率失败 ${currency}→${to} ${start}..${rangeEnd}: ${String(error)}`,
        );
      }
    }
  }

  private recentlyFailed(key: string): boolean {
    const at = this.failedAt.get(key);
    return at !== undefined && Date.now() - at < RETRY_AFTER_MS;
  }

  private async storeProviderRates(rates: ProviderRate[]): Promise<number> {
    let written = 0;
    for (const rate of rates) {
      if (!isSupportedCurrency(rate.from) || !isSupportedCurrency(rate.to)) continue;
      // 全局行的唯一约束是部分唯一索引，Prisma upsert 表达不了，用原生 ON CONFLICT。
      written += await this.prisma.client.$executeRaw`
        INSERT INTO exchange_rates (from_currency, to_currency, rate_date, rate, source)
        VALUES (${rate.from}, ${rate.to}, ${rate.date}::date, ${rate.rate}::numeric, 'frankfurter')
        ON CONFLICT (from_currency, to_currency, rate_date) WHERE ledger_id IS NULL
        DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()`;
    }
    return written;
  }

  /** 各账本在用的「外币 → 本币」组合：账户、订阅、近 90 天交易、规则与模板。 */
  private async pairsInUse(): Promise<Array<{ from: string; to: string }>> {
    const since = new Date(Date.now() - 90 * DAY_MS);
    const rows = await this.prisma.client.$queryRaw<Array<{ from: string; to: string }>>`
      SELECT DISTINCT x.currency AS "from", l.currency AS "to"
      FROM ledgers l
      JOIN (
        SELECT ledger_id, currency FROM accounts WHERE archived_at IS NULL
        UNION SELECT ledger_id, currency FROM subscriptions
          WHERE currency IS NOT NULL AND deleted_at IS NULL AND terminated_at IS NULL
        UNION SELECT ledger_id, original_currency FROM transactions
          WHERE original_currency IS NOT NULL AND deleted_at IS NULL AND occurred_on >= ${since}
        UNION SELECT ledger_id, to_currency FROM transactions
          WHERE to_currency IS NOT NULL AND deleted_at IS NULL AND occurred_on >= ${since}
        UNION SELECT ledger_id, original_currency FROM auto_rules
          WHERE original_currency IS NOT NULL AND archived_at IS NULL
        UNION SELECT ledger_id, original_currency FROM quick_templates
          WHERE original_currency IS NOT NULL AND archived_at IS NULL
      ) x ON x.ledger_id = l.id
      WHERE l.deleted_at IS NULL AND x.currency <> l.currency`;
    return rows.map((row) => ({ from: row.from.trim(), to: row.to.trim() }));
  }
}
