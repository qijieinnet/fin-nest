import { Injectable } from "@nestjs/common";
import {
  autoPendingDataFromRule,
  BackgroundJobsService,
  currentTimeKey,
  DatabaseTransactionService,
  dateKey,
  nextRunDate,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
  todayKey,
  zonedDateTimeToUtc,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";

type AutoSchedulePayload = {
  ledgerId?: string;
  until?: string;
};

@Injectable()
export class AutoSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly jobs: BackgroundJobsService,
  ) {}

  async generateDuePending(payload: AutoSchedulePayload = {}): Promise<{ created: number; createdIds: string[] }> {
    // “今天”按应用时区判定；nextRunOn 是 UTC-midnight date-only，直接与 now 比较会晚 8 小时才生成。
    const until = payload.until ? parseDateOnly(payload.until) : parseDateOnly(todayKey());
    const rules = await this.prisma.client.autoRule.findMany({
      where: {
        ledgerId: payload.ledgerId,
        enabled: true,
        archivedAt: null,
        nextRunOn: { not: null, lte: until },
      },
      orderBy: { nextRunOn: "asc" },
    });

    // 显式指定了记账时间的规则，当天必须过点才生成——否则用户设的 21:00 会在凌晨就被记上，
    // 推送也跟着提前。做法是把这类规则的 until 收回到昨天，等过点的那一轮再放行。
    const nowTime = currentTimeKey();
    const yesterday = new Date(until);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    let created = 0;
    const createdIds: string[] = [];
    for (const rule of rules) {
      const holding = Boolean(rule.runTime && rule.runTime > nowTime);
      const ruleUntil = holding ? yesterday : until;
      // 收回后可能已经早于 nextRunOn，说明今天这期还没到点。
      if (rule.nextRunOn && rule.nextRunOn > ruleUntil) {
        // 必须补一个定时唤醒：触发本轮的 job 已经消费掉了，不排新的就没人在 runTime 到点时回来，
        // 今天这期会一直生成不出来（本方法只由 auto.schedule job 驱动，不是每轮轮询都跑）。
        await this.scheduleRunTimeWakeup(rule.ledgerId, rule.runTime!);
        continue;
      }
      const ids = await this.txs.run((tx) => this.generateForRule(tx, rule, ruleUntil));
      created += ids.length;
      createdIds.push(...ids);
    }
    return { created, createdIds };
  }

  /**
   * 在今天的 runTime 时刻重新触发本账本的调度。
   *
   * 去重靠查一遍同 runAfter 的 pending job：同一账本可能有多条规则设在同一时刻，
   * 每条都排一个是白费；而且这个方法每轮 job 触发都可能走到，不去重会越积越多。
   */
  private async scheduleRunTimeWakeup(ledgerId: string, runTime: string): Promise<void> {
    const runAfter = zonedDateTimeToUtc(todayKey(), runTime);
    // ledgerId 必须进 where，不能查出一条再在内存里比对：同一时刻可能已排着**别的账本**的
    // 唤醒 job，那样每轮都会判定「不是我的」而重复入队，job 表越堆越多。
    const existing = await this.prisma.client.backgroundJob.findFirst({
      where: {
        type: "auto.schedule",
        status: "pending",
        runAfter,
        payload: { path: ["ledgerId"], equals: ledgerId },
      },
      select: { id: true },
    });
    if (existing) return;
    await this.jobs.enqueue({ type: "auto.schedule", payload: { ledgerId }, runAfter });
  }

  private async generateForRule(
    tx: PrismaTransactionClient,
    rule: Prisma.AutoRuleGetPayload<Record<string, never>>,
    until: Date,
  ): Promise<string[]> {
    let cursor = rule.nextRunOn;
    let nextRun: Date | null = cursor;
    const createdIds: string[] = [];
    while (cursor && cursor <= until) {
      const periodKey = dateKey(cursor);
      const existing = await tx.autoPendingTransaction.findUnique({
        where: { autoRuleId_periodKey: { autoRuleId: rule.id, periodKey } },
      });
      if (!existing) {
        // 业务字段整份由 autoPendingDataFromRule 搬运（清单按 DMMF 现算），
        // 这里只补「哪个账本、哪条规则」——加字段时不需要再回来改这一处。
        const pending = await tx.autoPendingTransaction.create({
          data: {
            ledgerId: rule.ledgerId,
            autoRuleId: rule.id,
            ...autoPendingDataFromRule(rule, { periodKey, scheduledFor: cursor }),
          },
        });
        createdIds.push(pending.id);
      }
      nextRun = nextRunDate(cursor, rule.repeatRule);
      cursor = nextRun;
    }
    await tx.autoRule.update({ where: { id: rule.id }, data: { nextRunOn: nextRun } });
    if (nextRun) {
      await this.jobs.enqueue(
        { type: "auto.schedule", payload: { ledgerId: rule.ledgerId }, runAfter: nextRun },
        tx,
      );
    }
    return createdIds;
  }
}
