import { Injectable } from "@nestjs/common";
import {
  currentTimeKey,
  dateKey,
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
