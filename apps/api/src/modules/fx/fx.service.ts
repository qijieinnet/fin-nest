import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  dateKey,
  type FxQuote,
  FxRateService,
  PrismaService,
  todayKey,
} from "@fin-nest/backend";
import { parseFxRate } from "@fin-nest/shared";
import { LedgersService } from "../ledgers/ledgers.service";
import { FxRateQueryDto } from "./dto/fx-rate-query.dto";
import { UpsertFxRateDto } from "./dto/upsert-fx-rate.dto";

export type FxQuoteView = {
  from: string;
  to: string;
  date: string;
  rate: string;
  source: FxQuote["source"];
};

function view(quote: FxQuote | null): FxQuoteView | null {
  if (!quote) return null;
  return {
    from: quote.from,
    to: quote.to,
    date: quote.date,
    rate: quote.rate,
    source: quote.source,
  };
}

const DAY_MS = 86_400_000;

/** 汇率接口（多币种方案 §5）：查询、在用币种一览、手填覆盖。 */
@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
    private readonly audit: AuditLogService,
    private readonly fx: FxRateService,
  ) {}

  async rate(ledgerId: string, userId: string, query: FxRateQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const base = await this.baseCurrency(ledgerId);
    const quote = await this.fx.findRate(
      ledgerId,
      query.from,
      query.to ?? base,
      query.date ?? todayKey(),
    );
    return { quote: view(quote) };
  }

  async overview(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const base = await this.baseCurrency(ledgerId);
    const since = new Date(Date.now() - 365 * DAY_MS);
    const db = this.prisma.client;
    const [accounts, subscriptions, transactions, rules, templates, manual] = await Promise.all([
      db.account.findMany({ where: { ledgerId, archivedAt: null }, select: { currency: true } }),
      db.subscription.findMany({
        where: { ledgerId, deletedAt: null, currency: { not: null } },
        select: { currency: true },
      }),
      db.transaction.findMany({
        where: {
          ledgerId,
          deletedAt: null,
          occurredOn: { gte: since },
          originalCurrency: { not: null },
        },
        select: { originalCurrency: true, toCurrency: true },
        distinct: ["originalCurrency", "toCurrency"],
      }),
      db.autoRule.findMany({
        where: { ledgerId, archivedAt: null, originalCurrency: { not: null } },
        select: { originalCurrency: true },
      }),
      db.quickTemplate.findMany({
        where: { ledgerId, archivedAt: null, originalCurrency: { not: null } },
        select: { originalCurrency: true },
      }),
      db.exchangeRate.findMany({
        where: { ledgerId },
        orderBy: [{ rateDate: "desc" }, { fromCurrency: "asc" }],
        take: 200,
      }),
    ]);
    const inUse = new Set<string>();
    for (const row of accounts) inUse.add(row.currency);
    for (const row of subscriptions) if (row.currency) inUse.add(row.currency);
    for (const row of transactions) {
      if (row.originalCurrency) inUse.add(row.originalCurrency);
      if (row.toCurrency) inUse.add(row.toCurrency);
    }
    for (const row of [...rules, ...templates])
      if (row.originalCurrency) inUse.add(row.originalCurrency);
    for (const row of manual)
      inUse.add(row.fromCurrency === base ? row.toCurrency : row.fromCurrency);
    inUse.delete(base);

    const currencies = [];
    for (const currency of [...inUse].sort()) {
      currencies.push({
        currency,
        providerSupported: this.fx.providerSupports(currency, base),
        latest: view(await this.fx.findRate(ledgerId, currency, base)),
      });
    }
    return {
      baseCurrency: base,
      provider: this.fx.providerName,
      currencies,
      manualRates: manual.map((row) => ({
        id: row.id,
        fromCurrency: row.fromCurrency,
        toCurrency: row.toCurrency,
        date: dateKey(row.rateDate),
        rate: row.rate.toFixed(),
        updatedAt: row.updatedAt,
      })),
    };
  }

  async upsertManual(ledgerId: string, userId: string, input: UpsertFxRateDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const base = await this.baseCurrency(ledgerId);
    if (input.currency === base) {
      throw new AppError("FX_RATE_BASE_CURRENCY", "本币不需要汇率", 400);
    }
    if (!parseFxRate(input.rate)) {
      throw new AppError("FX_RATE_INVALID", "汇率必须大于 0", 400);
    }
    const row = await this.fx.upsertManual(this.prisma.client, {
      ledgerId,
      from: input.currency,
      to: base,
      date: input.date,
      rate: input.rate,
      userId,
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "fx_rate.upsert",
      entityType: "exchange_rate",
      entityId: row.id,
      metadata: { currency: input.currency, date: input.date, rate: input.rate },
    });
    return {
      id: row.id,
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      date: dateKey(row.rateDate),
      rate: row.rate.toFixed(),
      updatedAt: row.updatedAt,
    };
  }

  async deleteManual(ledgerId: string, userId: string, rateId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    const row = await this.prisma.client.exchangeRate.findFirst({
      where: { id: rateId, ledgerId },
    });
    if (!row) throw new AppError("FX_RATE_NOT_FOUND", "汇率记录不存在", 404);
    await this.prisma.client.exchangeRate.delete({ where: { id: rateId } });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "fx_rate.delete",
      entityType: "exchange_rate",
      entityId: rateId,
      metadata: { from: row.fromCurrency, to: row.toCurrency, date: dateKey(row.rateDate) },
    });
  }

  private async baseCurrency(ledgerId: string): Promise<string> {
    const ledger = await this.prisma.client.ledger.findFirstOrThrow({
      where: { id: ledgerId, deletedAt: null },
      select: { currency: true },
    });
    return ledger.currency;
  }
}
