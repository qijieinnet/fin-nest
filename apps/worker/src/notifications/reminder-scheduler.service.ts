import { Injectable } from "@nestjs/common";
import {
  currentTimeKey,
  dateKey,
  formatMicros,
  NotificationService,
  parseDateOnly,
  PrismaService,
  ReminderOccurrence,
  subscriptionLeadKey,
  subscriptionReminderDate,
  todayKey,
  zonedDateTimeToUtc,
} from "@fin-nest/backend";

/**
 * 订阅到期提醒的推送调度。
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
    const today = todayKey();
    const nowTime = currentTimeKey();

    // 只捞配了推送目标的订阅：没人接收就不必参与后面的日期计算。
    const targets = await this.prisma.client.reminderTarget.findMany({
      where: { sourceType: "subscription", channel: "feishu" },
    });
    if (!targets.length) return { enqueued: 0 };

    const subscriptions = await this.prisma.client.subscription.findMany({
      where: {
        id: { in: Array.from(new Set(targets.map((target) => target.sourceId))) },
        deletedAt: null,
        terminatedAt: null,
        remindTime: { not: null },
      },
    });
    const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));

    // 提醒日 = 今天，且已过提醒时刻。remindTime 与 currentTimeKey 都是同一时区的 HH:mm 字面量，
    // 于是「到点了没」就是字符串比较，不经手任何 UTC ↔ 本地换算。
    const dueSubscriptionIds = new Set(
      subscriptions
        .filter((subscription) => {
          const remindOn = subscriptionReminderDate(subscription);
          if (!remindOn || dateKey(remindOn) !== today) return false;
          return (subscription.remindTime ?? "") <= nowTime;
        })
        .map((subscription) => subscription.id),
    );
    if (!dueSubscriptionIds.size) return { enqueued: 0 };

    const dueTargets = targets.filter((target) => dueSubscriptionIds.has(target.sourceId));
    const bindings = await this.resolveBindings(dueTargets.map((target) => target.feishuBindingId));

    // 应发时刻按「提醒日 + 提醒时间」还原，而不是用 now()：这样补发（worker 停了一天）
    // 写进 scheduled_at 的仍是原定时刻，事后排查看得出该发的时间与实际发的时间差。
    let enqueued = 0;
    for (const target of dueTargets) {
      const subscription = subscriptionById.get(target.sourceId);
      const binding = bindings.get(target.feishuBindingId);
      if (!subscription || !binding) continue;
      // 目标写入时校验过成员身份，但那之后对方可能已退出账本，这里再挡一次。
      if (binding.ledgerIds.has(target.ledgerId) === false) continue;

      const created = await this.notifications.enqueue(
        buildOccurrence(target.ledgerId, subscription, binding.openId),
      );
      if (created) enqueued += 1;
    }
    return { enqueued };
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
    const [ledgers, categories, accounts] = await Promise.all([
      this.prisma.client.ledger.findMany({
        where: { id: { in: Array.from(new Set(pendings.map((p) => p.ledgerId))) } },
        select: { id: true, currency: true, amountDecimalPlaces: true },
      }),
      this.prisma.client.category.findMany({
        where: { id: { in: compact(pendings.map((p) => p.categoryId)) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.account.findMany({
        where: { id: { in: compact(pendings.flatMap((p) => [p.accountId, p.fromAccountId, p.toAccountId])) } },
        select: { id: true, name: true },
      }),
    ]);
    const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
    const nameById = new Map([...categories, ...accounts].map((row) => [row.id, row.name]));

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

type SubscriptionRow = {
  id: string;
  name: string;
  provider: string | null;
  planName: string | null;
  billingCycle: string | null;
  nextRenewalDate: Date | null;
  remindTime: string | null;
  remindLeadValue: number | null;
  remindLeadUnit: string | null;
};

function buildOccurrence(
  ledgerId: string,
  subscription: SubscriptionRow,
  openId: string,
): ReminderOccurrence {
  const renewalKey = subscription.nextRenewalDate ? dateKey(subscription.nextRenewalDate) : "none";
  const leadKey = subscriptionLeadKey(subscription);
  const remainingDays = daysUntil(subscription.nextRenewalDate);
  // 提前量段（leadKey）现在恒定，是给多档提醒预留的——见 subscriptionLeadKey 的注释。
  // occurrenceKey 不含收件人：多个接收人的行共享它，按钮动作按它跨行抢占。
  const occurrenceKey = `subscription:${subscription.id}:${renewalKey}:${leadKey}`;

  return {
    ledgerId,
    sourceType: "subscription",
    sourceId: subscription.id,
    channel: "feishu",
    targetRef: openId,
    dedupeKey: `${occurrenceKey}:${openId}`,
    occurrenceKey,
    scheduledAt: scheduledAtFor(subscription),
    payload: {
      kind: "subscription_due",
      title: `订阅即将到期：${subscription.name}`,
      leadDescription: describeLead(remainingDays),
      lines: [
        subscription.provider ? `服务商：${subscription.provider}` : null,
        subscription.planName ? `套餐：${subscription.planName}` : null,
        renewalKey === "none" ? null : `续费日：${renewalKey}`,
      ].filter((line): line is string => line !== null),
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
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  note: string | null;
};

/**
 * 待确认记账 → 推送事件。
 *
 * occurrenceKey 直接用待确认 id：一条待确认天然只对应一次推送事件（`(autoRuleId, periodKey)`
 * 已有唯一约束），不需要像订阅那样再拼续费日与提前档位。
 */
function buildPendingOccurrence(
  pending: PendingRow,
  openId: string,
  ledger: { currency: string; amountDecimalPlaces: number } | undefined,
  nameById: Map<string, string>,
): ReminderOccurrence {
  const occurrenceKey = `auto_pending:${pending.id}`;
  const amount = formatMicros(
    pending.amountMicros,
    ledger?.amountDecimalPlaces ?? 2,
    ledger?.currency,
  );
  const accountLine =
    pending.type === "transfer"
      ? `转出 → 转入：${nameById.get(pending.fromAccountId ?? "") ?? "未指定"} → ${nameById.get(pending.toAccountId ?? "") ?? "未指定"}`
      : `账户：${nameById.get(pending.accountId ?? "") ?? "未指定"}`;

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
      title: `自动记账待确认：${amount}`,
      leadDescription: `${TYPE_LABELS[pending.type] ?? pending.type} · ${dateKey(pending.scheduledFor)}`,
      lines: [
        pending.type === "transfer"
          ? null
          : `分类：${nameById.get(pending.categoryId ?? "") ?? "未分类"}`,
        accountLine,
        pending.note ? `备注：${pending.note}` : null,
      ].filter((line): line is string => line !== null),
      actions: [
        { key: "auto_pending_discard", label: "忽略", style: "default" },
        { key: "auto_pending_confirm", label: "确认记账", style: "primary" },
      ],
    },
  };
}

function compact(values: (string | null)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/**
 * 应发时刻 = 提醒日 + 提醒时间，两者都是应用时区的本地值，换算成 UTC 瞬间存库。
 * 提醒日缺失时退回当前时刻。
 */
function scheduledAtFor(subscription: SubscriptionRow): Date {
  const remindOn = subscriptionReminderDate(subscription);
  if (!remindOn || !subscription.remindTime) return new Date();
  return zonedDateTimeToUtc(dateKey(remindOn), subscription.remindTime);
}

function daysUntil(target: Date | null): number | null {
  if (!target) return null;
  const today = parseDateOnly(todayKey());
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function describeLead(remainingDays: number | null): string {
  if (remainingDays === null) return "未设置续费日";
  if (remainingDays < 0) return `已过期 ${-remainingDays} 天`;
  if (remainingDays === 0) return "今天到期";
  if (remainingDays === 1) return "明天到期";
  return `还有 ${remainingDays} 天`;
}
