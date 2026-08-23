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
  personId: string | null;
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

/**
 * 单个账户对净资产的有符号贡献。
 * money 账户的余额已按“account.balanceMicros = Σ子账户余额”的不变式拆到各子账户（含默认子账户），
 * 因此直接对计入净资产的子账户求和；无子账户的往来账户用账户余额。
 */
export function accountNetWorthMicros(account: NetWorthAccount, subs: NetWorthSub[]): bigint {
  if (!account.includeInNetWorth) return 0n;
  const included =
    subs.length === 0
      ? account.balanceMicros
      : subs.reduce((sum, sub) => (sub.includeInNetWorth ? sum + sub.balanceMicros : sum), 0n);
  return isLiabilityAccountType(account.type) ? -included : included;
}

/** 单笔流水对净资产的有符号变化：目标子账户未计入净资产则为 0，负债账户符号取反。 */
function entryNetWorthDeltaMicros(
  entry: NetWorthEntry,
  accountsById: Map<string, NetWorthAccount>,
  subsById: Map<string, NetWorthSub>,
): bigint {
  const account = accountsById.get(entry.accountId);
  if (!account || !account.includeInNetWorth) return 0n;
  let included: boolean;
  if (entry.subAccountId) {
    const sub = subsById.get(entry.subAccountId);
    included = sub ? sub.includeInNetWorth : false;
  } else {
    // 无子账户的往来账户：整户计入（已在上面判过账户级开关）。
    included = true;
  }
  if (!included) return 0n;
  return isLiabilityAccountType(account.type) ? -entry.amountDeltaMicros : entry.amountDeltaMicros;
}

export type NetWorthResult = {
  netWorthMicros: string;
  netWorthTrend: { month: string; netWorthMicros: string }[];
};

type NetWorthContext = {
  /** 各活跃账户对当前净资产的有符号贡献；按人拆分时只挑其中一部分求和。 */
  currentByAccount: Map<string, bigint>;
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

  const currentByAccount = new Map(
    activeAccounts.map((account) => [
      account.id,
      accountNetWorthMicros(account, subsByAccount.get(account.id) ?? []),
    ]),
  );

  return { currentByAccount, entries, accountsById, subsById, subsByAccount };
}

/** 当前净资产；传 accountIds 则只统计这些账户（按人拆分用）。 */
function currentNetWorth(ctx: NetWorthContext, accountIds?: ReadonlySet<string>): bigint {
  let sum = 0n;
  for (const [accountId, micros] of ctx.currentByAccount) {
    if (accountIds && !accountIds.has(accountId)) continue;
    sum += micros;
  }
  return sum;
}

/**
 * 某时刻净资产 = 当前净资产 − 该时刻及之后所有流水的净资产变化。
 * 传 accountIds 则当前值与回放都只看这些账户，得到该子集的历史净资产。
 */
function netWorthAt(ctx: NetWorthContext, end: Date, accountIds?: ReadonlySet<string>): bigint {
  const futureDelta = ctx.entries.reduce(
    (sum, entry) =>
      entry.occurredAt >= end && (!accountIds || accountIds.has(entry.accountId))
        ? sum + entryNetWorthDeltaMicros(entry, ctx.accountsById, ctx.subsById)
        : sum,
    0n,
  );
  return currentNetWorth(ctx, accountIds) - futureDelta;
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
  return { netWorthMicros: currentNetWorth(ctx).toString(), netWorthTrend };
}

export type NetWorthRange = "week" | "month1" | "month6" | "year";

export type NetWorthPoint = { label: string; netWorthMicros: string };

/**
 * 按归属人员拆分的一条净资产曲线。`personId` 为 null 表示「未指定归属」的账户。
 * 归属只存当前值、没有历史，所以这里的历史点是按「当前归属」追溯重算的：
 * 把一个账户改挂到别人名下，两个人过去的曲线都会跟着变（总曲线不变）。
 */
export type NetWorthPersonSeries = {
  personId: string | null;
  name: string;
  icon: string | null;
  archived: boolean;
  netWorthMicros: string;
  points: NetWorthPoint[];
};

export type NetWorthSeries = {
  netWorthMicros: string;
  points: NetWorthPoint[];
  /** 只有显式要求按人拆分（`?groupBy=person`）且账本里有账户设过归属时才非空。 */
  people: NetWorthPersonSeries[];
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

type PersonAccountGroup = {
  personId: string | null;
  name: string;
  icon: string | null;
  archived: boolean;
  accountIds: Set<string>;
};

/**
 * 按归属人员把账户分桶（含归档账户：它们余额为 0，但历史流水仍属于当时那个人）。
 * 返回顺序：人员按 sortOrder，「未指定」永远排最后。
 */
async function groupAccountsByPerson(
  prisma: PrismaService,
  ledgerId: string,
  accounts: NetWorthAccount[],
): Promise<PersonAccountGroup[]> {
  const byPerson = new Map<string | null, Set<string>>();
  for (const account of accounts) {
    const key = account.personId ?? null;
    const bucket = byPerson.get(key) ?? new Set<string>();
    bucket.add(account.id);
    byPerson.set(key, bucket);
  }
  // 全账本都没设归属：不做拆分，省掉一次人员查询。
  if (byPerson.size === 1 && byPerson.has(null)) return [];

  // 含归档人员：账户可以挂着一个已归档的人员，名字仍要显示得出来。
  const people = await prisma.client.person.findMany({
    where: { ledgerId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, icon: true, archivedAt: true },
  });

  const groups: PersonAccountGroup[] = people
    .filter((person) => byPerson.has(person.id))
    .map((person) => ({
      personId: person.id,
      name: person.name,
      icon: person.icon,
      archived: person.archivedAt !== null,
      accountIds: byPerson.get(person.id)!,
    }));
  const unassigned = byPerson.get(null);
  if (unassigned) {
    groups.push({
      personId: null,
      name: "未指定",
      icon: null,
      archived: false,
      accountIds: unassigned,
    });
  }
  return groups;
}

/**
 * 按范围（近1周/近1个月/近6个月/近1年）计算净资产走势。
 * `groupByPerson` 时额外按归属人员各拆一条曲线——多算 N 份，默认不做。
 */
export async function buildNetWorthSeries(
  prisma: PrismaService,
  ledgerId: string,
  range: NetWorthRange,
  groupByPerson = false,
): Promise<NetWorthSeries> {
  const { boundaries, since } = rangeBoundaries(range, new Date());
  const ctx = await loadNetWorthContext(prisma, ledgerId, since);
  const points = boundaries.map((boundary) => ({
    label: boundary.label,
    netWorthMicros: netWorthAt(ctx, boundary.end).toString(),
  }));
  const groups = groupByPerson
    ? await groupAccountsByPerson(prisma, ledgerId, [...ctx.accountsById.values()])
    : [];
  const people = groups.map((group) => ({
    personId: group.personId,
    name: group.name,
    icon: group.icon,
    archived: group.archived,
    netWorthMicros: currentNetWorth(ctx, group.accountIds).toString(),
    points: boundaries.map((boundary) => ({
      label: boundary.label,
      netWorthMicros: netWorthAt(ctx, boundary.end, group.accountIds).toString(),
    })),
  }));
  return { netWorthMicros: currentNetWorth(ctx).toString(), points, people };
}
