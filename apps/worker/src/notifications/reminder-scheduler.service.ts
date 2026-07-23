import { Injectable } from "@nestjs/common";
import {
  currentTimeKey,
  dateKey,
  formatMicros,
  matchesEntryReminderDate,
  NotificationAmountTone,
  NotificationField,
  NotificationService,
  parseDateOnly,
  PrismaService,
  reminderCycleKey,
  ReminderOccurrence,
  scheduleLeadKey,
  scheduleReminderDate,
  todayKey,
  zonedDateTimeToUtc,
} from "@fin-nest/backend";

/**
 * 到期提醒的推送调度（订阅 / 保单 / 自动记账待确认）。
 *
 * 走「扫表」而不是「给每条订阅排一个定时 job」：订阅的增删改、续费日推进、提醒时间修改
 * 都会改变应发时刻，排 job 就得在这些路径上逐一 cancel + 重排，漏一处就静默不发。
 * 扫表则只依赖当前数据算「现在该发什么」，规则怎么改都无需回收历史状态；
 * 幂等由 `notifications.dedupe_key` 兜底，重复扫描不会重复发送。
 *
 * 精度上限是 worker 轮询间隔（WORKER_POLL_INTERVAL_MS，默认 30s），对到期提醒足够。
 */
@Injectable()
export class ReminderSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async scanSubscriptions(): Promise<{ enqueued: number }> {
    const due = await this.collectDueTiers(
      "subscription",
      (sourceIds) =>
        this.prisma.client.subscription.findMany({
          where: { id: { in: sourceIds }, deletedAt: null, terminatedAt: null },
        }),
      (subscription) => subscription.nextRenewalDate,
    );
    if (!due.length) return { enqueued: 0 };

    const bindings = await this.resolveBindings(
      due.flatMap((tier) => tier.targets.map((target) => target.feishuBindingId)),
    );
    // 卡片要展示费用与订阅分类，各自需要账本的币种/小数位与分类名。
    const [ledgers, categories] = await Promise.all([
      this.prisma.client.ledger.findMany({
        where: { id: { in: Array.from(new Set(due.map((tier) => tier.schedule.ledgerId))) } },
        select: { id: true, currency: true, amountDecimalPlaces: true },
      }),
      this.prisma.client.subscriptionCategory.findMany({
        where: { id: { in: compact(due.map((tier) => tier.row.categoryId)) } },
        select: { id: true, name: true },
      }),
    ]);
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
    const categoryNameById = new Map(categories.map((row) => [row.id, row.name]));

    let enqueued = 0;
    for (const tier of due) {
      for (const target of tier.targets) {
        const binding = bindings.get(target.feishuBindingId);
        // 目标写入时校验过成员身份，但那之后对方可能已退出账本，这里再挡一次。
        if (!binding || !binding.ledgerIds.has(target.ledgerId)) continue;
        const created = await this.notifications.enqueue(
          buildOccurrence(target.ledgerId, tier, binding.openId, {
            ledger: ledgerById.get(target.ledgerId),
            categoryName: categoryNameById.get(tier.row.categoryId ?? "") ?? null,
          }),
        );
        if (created) enqueued += 1;
      }
    }
    return { enqueued };
  }

  /**
   * 保单到期提醒。与订阅同一套「扫表 + dedupeKey 幂等」，只是基准日换成保单到期日。
   *
   * 保单没有「确认续保」这种能自动推进日期的动作（续保通常要改保额/保费，甚至换一张保单），
   * 因此卡片只挂一个「已确认」——点了不改任何数据，只标记本轮已处理，好让后续档位闭嘴。
   */
  async scanInsurances(): Promise<{ enqueued: number }> {
    const due = await this.collectDueTiers(
      "insurance",
      (sourceIds) =>
        this.prisma.client.insurance.findMany({
          where: { id: { in: sourceIds }, deletedAt: null, terminatedAt: null },
        }),
      (insurance) => insurance.endDate,
    );
    if (!due.length) return { enqueued: 0 };

    const bindings = await this.resolveBindings(
      due.flatMap((tier) => tier.targets.map((target) => target.feishuBindingId)),
    );
    const [ledgers, insuredNames] = await Promise.all([
      this.prisma.client.ledger.findMany({
        where: { id: { in: Array.from(new Set(due.map((tier) => tier.schedule.ledgerId))) } },
        select: { id: true, currency: true, amountDecimalPlaces: true },
      }),
      this.loadInsuredNames(Array.from(new Set(due.map((tier) => tier.row.id)))),
    ]);
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));

    let enqueued = 0;
    for (const tier of due) {
      for (const target of tier.targets) {
        const binding = bindings.get(target.feishuBindingId);
        if (!binding || !binding.ledgerIds.has(target.ledgerId)) continue;
        const created = await this.notifications.enqueue(
          buildInsuranceOccurrence(target.ledgerId, tier, binding.openId, {
            ledger: ledgerById.get(target.ledgerId),
            insuredNames: insuredNames.get(tier.row.id) ?? [],
          }),
        );
        if (created) enqueued += 1;
      }
    }
    return { enqueued };
  }

  /**
   * 找出「此刻该发」的提醒档位。订阅与保单只有基准日不同，判定逻辑完全一致。
   *
   * 三道筛：
   * ① 档位的提醒日 = 今天，且已过该档的提醒时刻（同为本地 HH:mm 字面量，直接字符串比较，
   *    不经手 UTC ↔ 本地换算）；
   * ② 该档配了接收人——没人接收的档位不必参与后面的查询；
   * ③ 本轮提醒（同一对象、同一基准日）尚未被处理过：用户在提前 30 天那档就点了确认/续订，
   *    提前 7 天那档就不该再推。在网页端处理（续费、改到期日）会改变基准日，
   *    后续档位的周期键随之改变，天然不会命中，无需额外判断。
   */
  private async collectDueTiers<TRow extends { id: string }>(
    sourceType: "subscription" | "insurance",
    loadRows: (sourceIds: string[]) => Promise<TRow[]>,
    baseDateOf: (row: TRow) => Date | null,
  ): Promise<DueTier<TRow>[]> {
    const today = todayKey();
    const nowTime = currentTimeKey();

    const targets = await this.prisma.client.reminderTarget.findMany({
      where: { sourceType: "reminder_schedule", channel: "feishu" },
    });
    if (!targets.length) return [];

    const schedules = await this.prisma.client.reminderSchedule.findMany({
      where: { sourceType, id: { in: Array.from(new Set(targets.map((t) => t.sourceId))) } },
    });
    if (!schedules.length) return [];

    const rows = await loadRows(Array.from(new Set(schedules.map((s) => s.sourceId))));
    const rowById = new Map(rows.map((row) => [row.id, row]));

    const targetsBySchedule = new Map<string, typeof targets>();
    for (const target of targets) {
      const bucket = targetsBySchedule.get(target.sourceId) ?? [];
      bucket.push(target);
      targetsBySchedule.set(target.sourceId, bucket);
    }

    const candidates: DueTier<TRow>[] = [];
    for (const schedule of schedules) {
      const row = rowById.get(schedule.sourceId);
      if (!row) continue;
      const baseDate = baseDateOf(row);
      if (!baseDate) continue;
      const remindOn = scheduleReminderDate(baseDate, schedule);
      if (!remindOn || dateKey(remindOn) !== today) continue;
      if (schedule.remindTime > nowTime) continue;
      const targetsForSchedule = targetsBySchedule.get(schedule.id) ?? [];
      if (!targetsForSchedule.length) continue;

      const dueKey = dateKey(baseDate);
      candidates.push({
        row,
        schedule,
        targets: targetsForSchedule,
        dueKey,
        cycleKey: reminderCycleKey(sourceType, row.id, dueKey),
        // 应发时刻按「提醒日 + 该档提醒时间」还原，而不是用 now()：这样补发（worker 停了一天）
        // 写进 scheduled_at 的仍是原定时刻，事后排查看得出该发的时间与实际发的时间差。
        scheduledAt: zonedDateTimeToUtc(dateKey(remindOn), schedule.remindTime),
      });
    }
    if (!candidates.length) return [];

    const handled = await this.notifications.handledCycleKeys(
      sourceType,
      Array.from(new Set(candidates.map((tier) => tier.row.id))),
    );
    return candidates.filter((tier) => !handled.has(tier.cycleKey));
  }

  /**
   * 记账提醒。与到期提醒的区别是**没有基准日**：命中的是重复周期（每天 / 每周某几天 /
   * 每月某几号），因此一个账本一天最多一条，`occurrenceKey` 用「账本 + 当天日期」。
   *
   * 卡片带上「今日已记 N 笔」——一条只说「该记账了」的提醒，用户还得自己打开应用确认，
   * 带上笔数就能直接判断要不要动手。
   */
  async scanEntryReminders(): Promise<{ enqueued: number }> {
    const today = todayKey();
    const nowTime = currentTimeKey();

    const targets = await this.prisma.client.reminderTarget.findMany({
      where: { sourceType: "entry_reminder", channel: "feishu" },
    });
    if (!targets.length) return { enqueued: 0 };

    const reminders = await this.prisma.client.entryReminder.findMany({
      where: {
        ledgerId: { in: Array.from(new Set(targets.map((t) => t.sourceId))) },
        enabled: true,
      },
    });
    // 日期判定全部在「本地日期」上做：todayKey() 已是应用时区的日历日，
    // parseDateOnly 把它还原成 UTC-midnight，星期与月内日号都从这个值取。
    const todayDate = parseDateOnly(today);
    const dueLedgerIds = new Set(
      reminders
        .filter(
          (reminder) =>
            reminder.remindTime <= nowTime && matchesEntryReminderDate(reminder, todayDate),
        )
        .map((reminder) => reminder.ledgerId),
    );
    if (!dueLedgerIds.size) return { enqueued: 0 };

    const dueTargets = targets.filter((target) => dueLedgerIds.has(target.sourceId));
    const bindings = await this.resolveBindings(dueTargets.map((target) => target.feishuBindingId));
    const [ledgers, counts] = await Promise.all([
      this.prisma.client.ledger.findMany({
        where: { id: { in: Array.from(dueLedgerIds) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.transaction.groupBy({
        by: ["ledgerId"],
        where: {
          ledgerId: { in: Array.from(dueLedgerIds) },
          occurredOn: todayDate,
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
    const countByLedger = new Map(counts.map((row) => [row.ledgerId, row._count._all]));

    const remindTimeByLedger = new Map(
      reminders.map((reminder) => [reminder.ledgerId, reminder.remindTime]),
    );

    let enqueued = 0;
    for (const target of dueTargets) {
      const binding = bindings.get(target.feishuBindingId);
      // 目标写入时校验过成员身份，但那之后对方可能已退出账本，这里再挡一次。
      if (!binding || !binding.ledgerIds.has(target.ledgerId)) continue;
      const created = await this.notifications.enqueue(
        buildEntryReminderOccurrence(target.ledgerId, binding.openId, {
          today,
          ledgerName: ledgerById.get(target.ledgerId)?.name ?? "账本",
          todayCount: countByLedger.get(target.ledgerId) ?? 0,
          scheduledAt: zonedDateTimeToUtc(
            today,
            remindTimeByLedger.get(target.ledgerId) ?? "00:00",
          ),
        }),
      );
      if (created) enqueued += 1;
    }
    return { enqueued };
  }

  /** 被保人姓名，按保单聚合。中间表只有 id，姓名要再查一次 `people`。 */
  private async loadInsuredNames(insuranceIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!insuranceIds.length) return result;

    const rows = await this.prisma.client.insuranceInsuredPerson.findMany({
      where: { insuranceId: { in: insuranceIds } },
    });
    if (!rows.length) return result;

    const people = await this.prisma.client.person.findMany({
      where: { id: { in: Array.from(new Set(rows.map((row) => row.personId))) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(people.map((person) => [person.id, person.name]));
    for (const row of rows) {
      const name = nameById.get(row.personId);
      if (!name) continue;
      const bucket = result.get(row.insuranceId) ?? [];
      bucket.push(name);
      result.set(row.insuranceId, bucket);
    }
    return result;
  }

  /**
   * 为刚生成的待确认记账入队推送。
   *
   * 与订阅提醒的区别：订阅是「扫表判定该不该发」，这里是**事件驱动**——待确认刚被创建出来，
   * 天然只发生一次，所以直接按 id 入队即可。幂等仍由 dedupeKey 兜底（重跑同一批 id 不会重复发）。
   */
  async enqueueForPendings(pendingIds: string[]): Promise<{ enqueued: number }> {
    if (!pendingIds.length) return { enqueued: 0 };

    const pendings = await this.prisma.client.autoPendingTransaction.findMany({
      where: { id: { in: pendingIds }, status: "pending" },
    });
    if (!pendings.length) return { enqueued: 0 };

    const targets = await this.prisma.client.reminderTarget.findMany({
      where: {
        sourceType: "auto_rule",
        sourceId: { in: Array.from(new Set(pendings.map((p) => p.autoRuleId))) },
        channel: "feishu",
      },
    });
    if (!targets.length) return { enqueued: 0 };

    const targetsByRule = new Map<string, typeof targets>();
    for (const target of targets) {
      const bucket = targetsByRule.get(target.sourceId) ?? [];
      bucket.push(target);
      targetsByRule.set(target.sourceId, bucket);
    }

    const bindings = await this.resolveBindings(targets.map((t) => t.feishuBindingId));
    // 卡片要和网页端的待确认详情展示同一组字段，因此分类/账户都要连二级一起取。
    const [ledgers, categories, subcategories, accounts, subAccounts, people] = await Promise.all([
      this.prisma.client.ledger.findMany({
        where: { id: { in: Array.from(new Set(pendings.map((p) => p.ledgerId))) } },
        select: { id: true, currency: true, amountDecimalPlaces: true },
      }),
      this.prisma.client.category.findMany({
        where: { id: { in: compact(pendings.map((p) => p.categoryId)) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.subcategory.findMany({
        where: { id: { in: compact(pendings.map((p) => p.subcategoryId)) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.account.findMany({
        where: {
          id: {
            in: compact(pendings.flatMap((p) => [p.accountId, p.fromAccountId, p.toAccountId])),
          },
        },
        select: { id: true, name: true },
      }),
      this.prisma.client.subAccount.findMany({
        where: {
          id: {
            in: compact(
              pendings.flatMap((p) => [p.subAccountId, p.fromSubAccountId, p.toSubAccountId]),
            ),
          },
        },
        select: { id: true, name: true },
      }),
      this.prisma.client.person.findMany({
        where: { id: { in: compact(pendings.map((p) => p.personId)) } },
        select: { id: true, name: true },
      }),
    ]);
    const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
    const nameById = new Map(
      [...categories, ...subcategories, ...accounts, ...subAccounts, ...people].map((row) => [
        row.id,
        row.name,
      ]),
    );

    let enqueued = 0;
    for (const pending of pendings) {
      const ledger = ledgerById.get(pending.ledgerId);
      for (const target of targetsByRule.get(pending.autoRuleId) ?? []) {
        const binding = bindings.get(target.feishuBindingId);
        // 目标写入时校验过成员身份，但那之后对方可能已退出账本，这里再挡一次。
        if (!binding || !binding.ledgerIds.has(pending.ledgerId)) continue;
        const created = await this.notifications.enqueue(
          buildPendingOccurrence(pending, binding.openId, ledger, nameById),
        );
        if (created) enqueued += 1;
      }
    }
    return { enqueued };
  }

  /** 取生效绑定，并带出各自「仍是成员」的账本集合，供发送前二次校验。 */
  private async resolveBindings(
    bindingIds: string[],
  ): Promise<Map<string, { openId: string; ledgerIds: Set<string> }>> {
    const result = new Map<string, { openId: string; ledgerIds: Set<string> }>();
    const unique = Array.from(new Set(bindingIds));
    if (!unique.length) return result;

    const bindings = await this.prisma.client.feishuBinding.findMany({
      where: { id: { in: unique }, revokedAt: null },
      select: { id: true, openId: true, userId: true },
    });
    if (!bindings.length) return result;

    const memberships = await this.prisma.client.ledgerMember.findMany({
      where: { userId: { in: bindings.map((binding) => binding.userId) }, removedAt: null },
      select: { userId: true, ledgerId: true },
    });
    const ledgersByUser = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const bucket = ledgersByUser.get(membership.userId) ?? new Set<string>();
      bucket.add(membership.ledgerId);
      ledgersByUser.set(membership.userId, bucket);
    }

    for (const binding of bindings) {
      result.set(binding.id, {
        openId: binding.openId,
        ledgerIds: ledgersByUser.get(binding.userId) ?? new Set<string>(),
      });
    }
    return result;
  }
}

/** 一档「此刻该发」的提醒：业务行 + 档位 + 该档接收人 + 算好的周期键与应发时刻。 */
type DueTier<TRow> = {
  row: TRow;
  schedule: ReminderScheduleRow;
  targets: ReminderTargetRow[];
  /** 基准日（订阅续费日 / 保单到期日）的 `YYYY-MM-DD`。 */
  dueKey: string;
  /** 同一对象同一基准日的所有档位共享，用来判断「本轮是否已被处理」。 */
  cycleKey: string;
  scheduledAt: Date;
};

type ReminderScheduleRow = {
  id: string;
  ledgerId: string;
  leadValue: number;
  leadUnit: string;
  remindTime: string;
};

type ReminderTargetRow = {
  ledgerId: string;
  feishuBindingId: string;
};

type SubscriptionRow = {
  id: string;
  name: string;
  categoryId: string | null;
  provider: string | null;
  planName: string | null;
  priceMicros: bigint | null;
  billingCycle: string | null;
  paymentMethod: string | null;
  autoRenew: boolean;
  nextRenewalDate: Date | null;
};

/** 与前端 `BILLING_CYCLE_OPTIONS` 的文案一致（value 同源于后端 `BILLING_CYCLE_LABELS`）。 */
const BILLING_CYCLE_LABELS: Record<string, string> = {
  weekly: "每周",
  monthly: "每月",
  quarterly: "每季",
  yearly: "每年",
  custom: "自定义",
};

/**
 * 订阅到期提醒 → 推送事件。
 *
 * 字段与网页端订阅详情的「订阅信息」一致，同样只在有值时出现。标题固定，订阅名放到副标题里
 * ——标题不写名字的话，收到的人无从判断是哪一笔订阅。
 */
function buildOccurrence(
  ledgerId: string,
  tier: DueTier<SubscriptionRow>,
  openId: string,
  context: {
    ledger: { currency: string; amountDecimalPlaces: number } | undefined;
    categoryName: string | null;
  },
): ReminderOccurrence {
  const subscription = tier.row;
  const remainingDays = daysUntil(subscription.nextRenewalDate);
  // occurrenceKey = 周期键 + 档位键。带档位是必须的：少了它「提前 7 天」与「提前 1 天」
  // 会算出同一个 dedupeKey，后一档被唯一约束静默吞掉。不含收件人——同一档的多个接收人
  // 共享它，按钮动作按它跨行抢占。
  const occurrenceKey = `${tier.cycleKey}:${scheduleLeadKey(tier.schedule)}`;

  const fields: NotificationField[] = [];
  push(fields, "分类", context.categoryName);
  push(fields, "服务商", subscription.provider);
  push(fields, "套餐", subscription.planName);
  push(
    fields,
    "费用",
    subscription.priceMicros === null
      ? null
      : formatMicros(
          subscription.priceMicros,
          context.ledger?.amountDecimalPlaces ?? 2,
          context.ledger?.currency,
        ),
  );
  push(fields, "计费周期", label(BILLING_CYCLE_LABELS, subscription.billingCycle));
  push(fields, "续费方式", subscription.autoRenew ? "自动续费" : "手动续费");
  push(fields, "支付方式", subscription.paymentMethod);
  push(fields, "续费日期", tier.dueKey);

  return {
    ledgerId,
    sourceType: "subscription",
    sourceId: subscription.id,
    channel: "feishu",
    targetRef: openId,
    dedupeKey: `${occurrenceKey}:${openId}`,
    occurrenceKey,
    scheduledAt: tier.scheduledAt,
    payload: {
      kind: "subscription_due",
      title: "订阅到期提醒",
      leadDescription: `${subscription.name} · ${describeLead(remainingDays, "未设置续费日")}`,
      fields,
      // 确认续订要按计费周期推算下一个续费日，自定义/未知周期推不出来，
      // 此时只留退订按钮，避免用户点了才收到「无法自动推算」的错误。
      actions: [
        { key: "subscription_terminate", label: "退订", style: "danger" },
        ...(canAdvance(subscription.billingCycle)
          ? [{ key: "subscription_renew" as const, label: "确认续订", style: "primary" as const }]
          : []),
      ],
    },
  };
}

type InsuranceRow = {
  id: string;
  name: string;
  type: string;
  insurer: string | null;
  paymentMethod: string | null;
  premiumMicros: bigint | null;
  premiumFreq: string | null;
  renewal: string | null;
  endDate: Date | null;
};

/** 与前端 `INSURANCE_TYPES` / `PREMIUM_FREQ_OPTIONS` / `RENEWAL_OPTIONS` 的文案一致。 */
const INSURANCE_TYPE_LABELS: Record<string, string> = {
  medical: "医疗",
  critical: "重疾",
  life: "寿险",
  accident: "意外",
  car: "车险",
  property: "家财",
  other: "其他",
};

const PREMIUM_FREQ_LABELS: Record<string, string> = {
  year: "年缴",
  month: "月缴",
  single: "趸缴",
};

const RENEWAL_LABELS: Record<string, string> = {
  auto: "自动续保",
  manual: "手动续保",
};

/**
 * 保单到期提醒 → 推送事件。
 *
 * 字段取自网页端保单详情的「保单信息」，标题固定、保单名放副标题，与订阅卡片同一形态。
 * 唯一的按钮是「已确认」：它不改任何保单数据，只把这一轮提醒标成已处理，
 * 后续档位（如提前 7 天那档）据此不再推送。
 */
function buildInsuranceOccurrence(
  ledgerId: string,
  tier: DueTier<InsuranceRow>,
  openId: string,
  context: {
    ledger: { currency: string; amountDecimalPlaces: number } | undefined;
    insuredNames: string[];
  },
): ReminderOccurrence {
  const insurance = tier.row;
  const occurrenceKey = `${tier.cycleKey}:${scheduleLeadKey(tier.schedule)}`;
  const remainingDays = daysUntil(insurance.endDate);

  const fields: NotificationField[] = [];
  push(fields, "险种", INSURANCE_TYPE_LABELS[insurance.type] ?? insurance.type);
  push(fields, "保险公司", insurance.insurer);
  push(fields, "被保人", context.insuredNames.join("、") || null);
  push(fields, "缴费方式", insurance.paymentMethod);
  push(fields, "缴费周期", label(PREMIUM_FREQ_LABELS, insurance.premiumFreq));
  // 趸缴是一次性交清，没有续费一说——与网页端详情同样的隐藏条件。
  if (insurance.premiumFreq !== "single") {
    push(fields, "续费", label(RENEWAL_LABELS, insurance.renewal));
  }
  push(
    fields,
    "需缴费用",
    insurance.premiumMicros === null
      ? null
      : formatMicros(
          insurance.premiumMicros,
          context.ledger?.amountDecimalPlaces ?? 2,
          context.ledger?.currency,
        ),
  );

  return {
    ledgerId,
    sourceType: "insurance",
    sourceId: insurance.id,
    channel: "feishu",
    targetRef: openId,
    dedupeKey: `${occurrenceKey}:${openId}`,
    occurrenceKey,
    scheduledAt: tier.scheduledAt,
    payload: {
      kind: "insurance_due",
      title: "保险到期提醒",
      leadDescription: `${insurance.name} · ${describeLead(remainingDays, "未设置到期日")}`,
      fields,
      actions: [{ key: "insurance_acknowledge", label: "已确认", style: "primary" }],
    },
  };
}

/** 未收录的枚举值直接显示原值，不显示成空——它也是用户填进去的信息。 */
function label(labels: Record<string, string>, value: string | null): string | null {
  if (!value) return null;
  return labels[value] ?? value;
}

/** 与 AssetsService.advanceRenewalDate 的支持范围保持一致。 */
function canAdvance(billingCycle: string | null): boolean {
  return ["weekly", "monthly", "quarterly", "yearly"].includes(billingCycle ?? "");
}

const TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
};

type PendingRow = {
  id: string;
  ledgerId: string;
  type: string;
  amountMicros: bigint;
  scheduledFor: Date;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  personId: string | null;
  note: string | null;
};

/**
 * 待确认记账 → 推送事件。
 *
 * occurrenceKey 直接用待确认 id：一条待确认天然只对应一次推送事件（`(autoRuleId, periodKey)`
 * 已有唯一约束），不需要像订阅那样再拼续费日与提前档位。
 *
 * 字段与网页端的待确认详情（`BillDetailScreen` 的 pending 模式）对齐：同样的标签、同样的
 * 顺序、同样「有值才显示」的规则——两处看到的不是同一笔账会让人怀疑推的是不是别的记录。
 * 详情里的「生成时间 / 状态」不带上：推送本身就是刚生成、就是待确认。
 */
function buildPendingOccurrence(
  pending: PendingRow,
  openId: string,
  ledger: { currency: string; amountDecimalPlaces: number } | undefined,
  nameById: Map<string, string>,
): ReminderOccurrence {
  const occurrenceKey = `auto_pending:${pending.id}`;
  const isTransfer = pending.type === "transfer";
  const name = (id: string | null) => (id ? (nameById.get(id) ?? null) : null);
  const twoLevel = (id: string | null, subId: string | null) => {
    const top = name(id);
    if (!top) return null;
    const sub = name(subId);
    return sub ? `${top} / ${sub}` : top;
  };

  const fields: NotificationField[] = [
    { label: "记录类型", value: TYPE_LABELS[pending.type] ?? pending.type },
  ];
  if (isTransfer) {
    push(fields, "转出账户", twoLevel(pending.fromAccountId, pending.fromSubAccountId));
    push(fields, "转入账户", twoLevel(pending.toAccountId, pending.toSubAccountId));
  } else {
    push(fields, "分类", twoLevel(pending.categoryId, pending.subcategoryId));
    push(fields, "账户", twoLevel(pending.accountId, pending.subAccountId));
  }
  push(fields, "计划入账日期", dateKey(pending.scheduledFor));
  push(fields, "人员", name(pending.personId));
  push(fields, "备注", pending.note?.trim() || null);

  return {
    ledgerId: pending.ledgerId,
    sourceType: "auto_pending",
    sourceId: pending.id,
    channel: "feishu",
    targetRef: openId,
    dedupeKey: `${occurrenceKey}:${openId}`,
    occurrenceKey,
    // 待确认刚生成就该推，不像订阅提醒有「当天某时刻」的概念。
    scheduledAt: new Date(),
    payload: {
      kind: "auto_pending",
      title: "自动记账待确认",
      leadDescription: "",
      amount: {
        text: signedAmount(pending.type, pending.amountMicros, ledger),
        tone: amountTone(pending.type),
      },
      fields,
      // 文案与网页端待确认详情的两个按钮一致。
      actions: [
        { key: "auto_pending_discard", label: "删除待确认", style: "danger" },
        { key: "auto_pending_confirm", label: "确认入账", style: "primary" },
      ],
    },
  };
}

/** 值为空就整条字段不出现（详情页在这些位置也不显示空行）。 */
function push(fields: NotificationField[], label: string, value: string | null): void {
  if (value) fields.push({ label, value });
}

/** 与详情页一致：支出带负号、收入带正号、转账不带符号。全程 bigint（硬规则 1）。 */
function signedAmount(
  type: string,
  amountMicros: bigint,
  ledger: { currency: string; amountDecimalPlaces: number } | undefined,
): string {
  const places = ledger?.amountDecimalPlaces ?? 2;
  if (type === "expense") return formatMicros(-amountMicros, places, ledger?.currency);
  const text = formatMicros(amountMicros, places, ledger?.currency);
  return type === "income" && amountMicros > 0n ? `+${text}` : text;
}

function amountTone(type: string): NotificationAmountTone {
  if (type === "expense") return "expense";
  if (type === "income") return "income";
  return "transfer";
}

function compact(values: (string | null)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function daysUntil(target: Date | null): number | null {
  if (!target) return null;
  const today = parseDateOnly(todayKey());
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function describeLead(remainingDays: number | null, noDateText: string): string {
  if (remainingDays === null) return noDateText;
  if (remainingDays < 0) return `已过期 ${-remainingDays} 天`;
  if (remainingDays === 0) return "今天到期";
  if (remainingDays === 1) return "明天到期";
  return `还有 ${remainingDays} 天`;
}

/**
 * 记账提醒 → 推送事件。
 *
 * 没有可执行的动作（记账要在应用里完成），因此是一张纯信息卡。
 */
function buildEntryReminderOccurrence(
  ledgerId: string,
  openId: string,
  context: { today: string; ledgerName: string; todayCount: number; scheduledAt: Date },
): ReminderOccurrence {
  // 一个账本一天最多一条，因此周期键里没有档位段。
  const occurrenceKey = `entry_reminder:${ledgerId}:${context.today}`;
  return {
    ledgerId,
    sourceType: "entry_reminder",
    sourceId: ledgerId,
    channel: "feishu",
    targetRef: openId,
    dedupeKey: `${occurrenceKey}:${openId}`,
    occurrenceKey,
    scheduledAt: context.scheduledAt,
    payload: {
      kind: "entry_reminder",
      title: "记账提醒",
      leadDescription: `${context.ledgerName} · ${context.today}`,
      fields: [
        // {
        //   label: "今日已记",
        //   value: context.todayCount === 0 ? "还没有记账" : `${context.todayCount} 笔`,
        // },
      ],
    },
  };
}
