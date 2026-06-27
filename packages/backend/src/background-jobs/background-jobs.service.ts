import { Injectable } from "@nestjs/common";
import { BackgroundJob, Prisma } from "@fin-nest/db";
import { PrismaService } from "../prisma/prisma.service";
import {
  ClaimedBackgroundJob,
  EnqueueBackgroundJobInput,
  RawBackgroundJob,
} from "./background-jobs.types";

@Injectable()
export class BackgroundJobsService {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(input: EnqueueBackgroundJobInput, tx: Prisma.TransactionClient = this.prisma.client): Promise<BackgroundJob> {
    return tx.backgroundJob.create({
      data: {
        type: input.type,
        status: "pending",
        payload: input.payload,
        runAfter: input.runAfter ?? new Date(),
        maxAttempts: input.maxAttempts ?? 3,
      },
    });
  }

  async claimNext(workerId: string, now = new Date()): Promise<ClaimedBackgroundJob | null> {
    const [row] = await this.prisma.client.$transaction((tx) =>
      tx.$queryRaw<RawBackgroundJob[]>`
        UPDATE background_jobs
           SET status = 'running',
               locked_at = ${now},
               locked_by = ${workerId},
               attempts = attempts + 1,
               updated_at = now()
         WHERE id = (
           SELECT id
             FROM background_jobs
            WHERE status = 'pending'
              AND run_after <= ${now}
              AND attempts < max_attempts
            ORDER BY run_after ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
        RETURNING id, type, status, payload, run_after, attempts, max_attempts,
                  locked_at, locked_by, last_error, created_at, updated_at
      `,
    );

    return row ? this.mapRawJob(row) : null;
  }

  async markSucceeded(jobId: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<void> {
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  async markFailed(
    jobId: string,
    error: unknown,
    retryAfter: Date,
    tx: Prisma.TransactionClient = this.prisma.client,
  ): Promise<void> {
    const job = await tx.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    const exhausted = job.attempts >= job.maxAttempts;

    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: exhausted ? "failed" : "pending",
        runAfter: exhausted ? job.runAfter : retryAfter,
        lockedAt: null,
        lockedBy: null,
        lastError: this.stringifyError(error),
      },
    });
  }

  async cancel(jobId: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<void> {
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 2000);
    return String(error).slice(0, 2000);
  }

  private mapRawJob(row: RawBackgroundJob): ClaimedBackgroundJob {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      payload: row.payload,
      runAfter: row.run_after,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lockedAt: row.locked_at,
      lockedBy: row.locked_by,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
