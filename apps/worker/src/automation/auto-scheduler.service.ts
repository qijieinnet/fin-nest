import { Injectable } from "@nestjs/common";
import {
  BackgroundJobsService,
  DatabaseTransactionService,
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

  async runDueJobs(workerId = `worker-${process.pid}`): Promise<{ processed: number; created: number }> {
    let processed = 0;
    let created = 0;
    while (true) {
      const job = await this.jobs.claimNext(workerId);
      if (!job) break;
      try {
        if (job.type === "auto.schedule") {
          created += (await this.generateDuePending(this.normalizePayload(job.payload))).created;
        }
        await this.jobs.markSucceeded(job.id);
        processed += 1;
      } catch (error) {
        await this.jobs.markFailed(job.id, error, new Date(Date.now() + 60_000));
      }
    }
    return { processed, created };
  }

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
      await this.jobs.enqueue({ type: "auto.schedule", payload: { ledgerId: rule.ledgerId }, runAfter: nextRun }, tx);
    }
    return created;
  }

  private normalizePayload(value: Prisma.JsonValue): AutoSchedulePayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as Record<string, unknown>;
    return {
      ledgerId: typeof payload.ledgerId === "string" ? payload.ledgerId : undefined,
      until: typeof payload.until === "string" ? payload.until : undefined,
    };
  }
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextRunDate(date: Date, repeatRule: string): Date | null {
  const next = new Date(date);
  if (repeatRule === "once") return null;
  if (repeatRule === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (repeatRule === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (repeatRule === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (repeatRule === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}
