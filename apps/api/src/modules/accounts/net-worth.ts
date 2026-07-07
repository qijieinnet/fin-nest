import { monthRange, PrismaService } from "@fin-nest/backend";

/**
 * 净资产计算的共享实现（`/stats` 与 `/statistics/overview` 复用同一套口径）：
 * 资产为正、负债（信用/需归还）为负；尊重账户级总开关、默认桶开关与命名子账户各自的开关。
 */

type NetWorthAccount = {
  id: string;
  type: string;
  balanceMicros: bigint;
  includeInNetWorth: boolean;
  defaultBucketIncludeInNetWorth: boolean;
};

type NetWorthSub = {
  id: string;
  accountId: string;
  balanceMicros: bigint;
  includeInNetWorth: boolean;
};

type NetWorthEntry = {
  accountId: string;
  subAccountId: string | null;
  amountDeltaMicros: bigint;
  occurredAt: Date;
};

export function isLiabilityAccountType(type: string): boolean {
  return type === "credit" || type === "payable";
}

/** 单个账户对净资产的有符号贡献。 */
export function accountNetWorthMicros(account: NetWorthAccount, subs: NetWorthSub[]): bigint {
  if (!account.includeInNetWorth) return 0n;
  let included: bigint;
  if (subs.length === 0) {
    included = account.balanceMicros;
  } else {
    const namedSum = subs.reduce(
      (sum, sub) => (sub.includeInNetWorth ? sum + sub.balanceMicros : sum),
      0n,
    );
    const totalSubs = subs.reduce((sum, sub) => sum + sub.balanceMicros, 0n);
    const defaultBucket = account.balanceMicros - totalSubs;
    included = (account.defaultBucketIncludeInNetWorth ? defaultBucket : 0n) + namedSum;
  }
  return isLiabilityAccountType(account.type) ? -included : included;
}

/** 单笔流水对净资产的有符号变化：目标部分未计入净资产则为 0，负债账户符号取反。 */
function entryNetWorthDeltaMicros(
  entry: NetWorthEntry,
  accountsById: Map<string, NetWorthAccount>,
  subsById: Map<string, NetWorthSub>,
  subsByAccount: Map<string, NetWorthSub[]>,
): bigint {
  const account = accountsById.get(entry.accountId);
  if (!account || !account.includeInNetWorth) return 0n;
  let included: boolean;
  if (entry.subAccountId) {
    const sub = subsById.get(entry.subAccountId);
    included = sub ? sub.includeInNetWorth : false;
  } else {
    const hasNamedSubs = (subsByAccount.get(account.id)?.length ?? 0) > 0;
    included = hasNamedSubs ? account.defaultBucketIncludeInNetWorth : true;
  }
  if (!included) return 0n;
  return isLiabilityAccountType(account.type) ? -entry.amountDeltaMicros : entry.amountDeltaMicros;
}

export type NetWorthResult = {
  netWorthMicros: string;
  netWorthTrend: { month: string; netWorthMicros: string }[];
};

type NetWorthContext = {
  currentNetWorth: bigint;
  entries: NetWorthEntry[];
  accountsById: Map<string, NetWorthAccount>;
  subsById: Map<string, NetWorthSub>;
  subsByAccount: Map<string, NetWorthSub[]>;
};

/** 拉取自 `since` 起的净资产上下文（当前净资产 + 流水 + 索引），供各种粒度重建复用。 */
async function loadNetWorthContext(
  prisma: PrismaService,
  ledgerId: string,
  since: Date,
): Promise<NetWorthContext> {
  const [activeAccounts, activeSubs, trendAccounts] = await Promise.all([
    prisma.client.account.findMany({ where: { ledgerId, archivedAt: null } }),
    prisma.client.subAccount.findMany({ where: { ledgerId, archivedAt: null } }),
    // 趋势需保留归档账户，避免归档后过去每个时段被静默改写。
    prisma.client.account.findMany({ where: { ledgerId } }),
  ]);

  const subsByAccount = new Map<string, NetWorthSub[]>();
  for (const sub of activeSubs) {
    const list = subsByAccount.get(sub.accountId) ?? [];
    list.push(sub);
    subsByAccount.set(sub.accountId, list);
  }
  const accountsById = new Map<string, NetWorthAccount>(
    trendAccounts.map((account) => [account.id, account]),
  );
  const subsById = new Map<string, NetWorthSub>(activeSubs.map((sub) => [sub.id, sub]));

  const entries = await prisma.client.accountEntry.findMany({
    where: {
      ledgerId,
      accountId: { in: trendAccounts.map((account) => account.id) },
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "asc" },
  });

  const currentNetWorth = activeAccounts.reduce(
    (sum, account) => sum + accountNetWorthMicros(account, subsByAccount.get(account.id) ?? []),
    0n,
  );

  return { currentNetWorth, entries, accountsById, subsById, subsByAccount };
}

/** 某时刻净资产 = 当前净资产 − 该时刻及之后所有流水的净资产变化。 */
function netWorthAt(ctx: NetWorthContext, end: Date): bigint {
  const futureDelta = ctx.entries.reduce(
    (sum, entry) =>
      entry.occurredAt >= end
        ? sum + entryNetWorthDeltaMicros(entry, ctx.accountsById, ctx.subsById, ctx.subsByAccount)
        : sum,
    0n,
  );
  return ctx.currentNetWorth - futureDelta;
}

/**
 * 计算当前净资产与最近 `months` 各月末净资产（按 `month` key）。
 * 归档账户/子账户余额已清零，仍保留在 map 中用于符号与类型判断，重建保持自洽。
 */
export async function buildNetWorth(
  prisma: PrismaService,
  ledgerId: string,
  months: string[],
): Promise<NetWorthResult> {
  const firstMonth = months[0];
  const since = firstMonth ? monthRange(firstMonth).start : new Date(0);
  const ctx = await loadNetWorthContext(prisma, ledgerId, since);
  const netWorthTrend = months.map((month) => ({
    month,
    netWorthMicros: netWorthAt(ctx, monthRange(month).end).toString(),
  }));
  return { netWorthMicros: ctx.currentNetWorth.toString(), netWorthTrend };
}

export type NetWorthRange = "week" | "month1" | "month6" | "year";

export type NetWorthSeries = {
  netWorthMicros: string;
  points: { label: string; netWorthMicros: string }[];
};

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** 按范围生成各时段的“结束边界”（下一天/下月起点，末段用 now）与需要拉取流水的起点。 */
function rangeBoundaries(
  range: NetWorthRange,
  now: Date,
): { boundaries: { label: string; end: Date }[]; since: Date } {
  if (range === "month6" || range === "year") {
    const count = range === "month6" ? 6 : 12;
    const boundaries: { label: string; end: Date }[] = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const end =
        offset === 0 ? now : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      boundaries.push({ label: `${monthStart.getMonth() + 1}月`, end });
    }
    return { boundaries, since: new Date(now.getFullYear(), now.getMonth() - (count - 1), 1) };
  }

  const days = range === "week" ? 7 : 30;
  const today = startOfDay(now);
  const boundaries: { label: string; end: Date }[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const end = offset === 0 ? now : new Date(day.getTime() + 86_400_000);
    boundaries.push({ label: `${day.getMonth() + 1}/${day.getDate()}`, end });
  }
  const since = new Date(today);
  since.setDate(today.getDate() - (days - 1));
  return { boundaries, since };
}

/** 按范围（近1周/近1个月/近6个月/近1年）计算净资产走势。 */
export async function buildNetWorthSeries(
  prisma: PrismaService,
  ledgerId: string,
  range: NetWorthRange,
): Promise<NetWorthSeries> {
  const { boundaries, since } = rangeBoundaries(range, new Date());
  const ctx = await loadNetWorthContext(prisma, ledgerId, since);
  const points = boundaries.map((boundary) => ({
    label: boundary.label,
    netWorthMicros: netWorthAt(ctx, boundary.end).toString(),
  }));
  return { netWorthMicros: ctx.currentNetWorth.toString(), points };
}
