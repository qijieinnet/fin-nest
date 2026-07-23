import { Injectable } from "@nestjs/common";
import { BackgroundJobsService, NotificationService } from "@fin-nest/backend";
import { AutoSchedulerService } from "./automation/auto-scheduler.service";
import { FileDeletePayload, FileDeleteService } from "./files/file-delete.service";
import { ReminderSchedulerService } from "./notifications/reminder-scheduler.service";

@Injectable()
export class WorkerRunnerService {
  constructor(
    private readonly autoScheduler: AutoSchedulerService,
    private readonly jobs: BackgroundJobsService,
    private readonly fileDelete: FileDeleteService,
    private readonly reminderScheduler: ReminderSchedulerService,
    private readonly notifications: NotificationService,
  ) {}

  async runOnce(): Promise<{ processed: number; created: number; notificationsSent: number }> {
    let processed = 0;
    let created = 0;
    // 回收 worker 崩溃遗留的 running 任务，否则它们会永远卡在 running 状态。
    await this.jobs.requeueStale(10 * 60_000);

    // 提醒推送不走 background_jobs：应发时刻由订阅数据算出，改配置就该立刻反映，
    // 排队的 job 反而要在每个改动路径上回收。扫表 + dedupeKey 幂等更省心（见 ReminderSchedulerService）。
    // 扫描抛错不能拖垮 job 循环，两者互不依赖。
    let notificationsSent = 0;
    try {
      await this.reminderScheduler.scanSubscriptions();
      notificationsSent = (await this.notifications.dispatchPending()).sent;
    } catch (error) {
      console.error("fin-nest-worker reminder dispatch failed:", error);
    }
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
    return { processed, created, notificationsSent };
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
