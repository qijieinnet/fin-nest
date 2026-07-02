import { Injectable } from "@nestjs/common";
import { BackgroundJobsService } from "@fin-nest/backend";
import { AutoSchedulerService } from "./automation/auto-scheduler.service";
import { FileDeletePayload, FileDeleteService } from "./files/file-delete.service";

@Injectable()
export class WorkerRunnerService {
  constructor(
    private readonly autoScheduler: AutoSchedulerService,
    private readonly jobs: BackgroundJobsService,
    private readonly fileDelete: FileDeleteService,
  ) {}

  async runOnce(): Promise<{ processed: number; created: number }> {
    let processed = 0;
    let created = 0;
    // 回收 worker 崩溃遗留的 running 任务，否则它们会永远卡在 running 状态。
    await this.jobs.requeueStale(10 * 60_000);
    while (true) {
      const job = await this.jobs.claimNext(`worker-${process.pid}`);
      if (!job) break;
      try {
        if (job.type === "auto.schedule") {
          created += (await this.autoScheduler.generateDuePending(this.autoSchedulerPayload(job.payload))).created;
        } else if (job.type === "file.delete") {
          await this.fileDelete.deleteObject(this.fileDeletePayload(job.payload));
        } else {
          throw new Error(`Unsupported background job type: ${job.type}`);
        }
        await this.jobs.markSucceeded(job.id);
        processed += 1;
      } catch (error) {
        await this.jobs.markFailed(job.id, error, new Date(Date.now() + 60_000));
      }
    }
    return { processed, created };
  }

  private autoSchedulerPayload(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as Record<string, unknown>;
    return {
      ledgerId: typeof payload.ledgerId === "string" ? payload.ledgerId : undefined,
      until: typeof payload.until === "string" ? payload.until : undefined,
    };
  }

  private fileDeletePayload(value: unknown): FileDeletePayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as Record<string, unknown>;
    return {
      fileId: typeof payload.fileId === "string" ? payload.fileId : undefined,
      bucket: typeof payload.bucket === "string" ? payload.bucket : undefined,
      objectKey: typeof payload.objectKey === "string" ? payload.objectKey : undefined,
    };
  }
}
