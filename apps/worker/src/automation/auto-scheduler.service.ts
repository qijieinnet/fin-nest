import { Injectable } from "@nestjs/common";
import {
  BackgroundJobsService,
  DatabaseTransactionService,
  dateKey,
  nextRunDate,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
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

  async generateDuePending(payload: AutoSchedulePayload = {}): Promise<{ created: number }> {
    const until = payload.until ? parseDateOnly(payload.until) : new Date();
    const rules = await this.prisma.client.autoRule.findMany({
      where: {
        ledgerId: payload.ledgerId,
        enabled: true,
        archivedAt: null,
        nextRunOn: { not: null, lte: until },
      },
      orderBy: { nextRunOn: "asc" },
    });

    let created = 0;
    for (const rule of rules) {
      created += await this.txs.run((tx) => this.generateForRule(tx, rule, until));
    }
    return { created };
  }

  private async generateForRule(
    tx: PrismaTransactionClient,
    rule: Prisma.AutoRuleGetPayload<Record<string, never>>,
    until: Date,
  ): Promise<number> {
    let cursor = rule.nextRunOn;
    let nextRun: Date | null = cursor;
    let created = 0;
    while (cursor && cursor <= until) {
      const periodKey = dateKey(cursor);
      const existing = await tx.autoPendingTransaction.findUnique({
        where: { autoRuleId_periodKey: { autoRuleId: rule.id, periodKey } },
      });
      if (!existing) {
        await tx.autoPendingTransaction.create({
          data: {
            ledgerId: rule.ledgerId,
            autoRuleId: rule.id,
            periodKey,
            scheduledFor: cursor,
            status: "pending",
            type: rule.type,
            amountMicros: rule.amountMicros,
            categoryId: rule.categoryId,
            subcategoryId: rule.subcategoryId,
            accountId: rule.accountId,
            subAccountId: rule.subAccountId,
            personId: rule.personId,
            note: rule.note,
          },
        });
        created += 1;
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
    return created;
  }
}
