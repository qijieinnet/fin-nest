import { Injectable } from "@nestjs/common";
import {
  BackgroundJobsService,
  FxRateService,
  NotificationService,
  SystemBackupService,
  todayKey,
} from "@fin-nest/backend";
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
    private readonly systemBackup: SystemBackupService,
    private readonly fx: FxRateService,
  ) {}

  /** 上次刷新汇率成功的本地日期；进程重启后会再刷一次，多一次请求无妨。 */
  private fxRefreshedOn: string | null = null;
  /** 刷新失败（外网不通）后的退避：一小时后再试，别每 30 秒打一次外网。 */
  private fxRetryAfter = 0;

  async runOnce(): Promise<{ processed: number; created: number; notificationsSent: number }> {
    const gated = await this.systemBackup.runWorkerBatch(() => this.runAllowedBatch());
    return gated.ran ? gated.value : { processed: 0, created: 0, notificationsSent: 0 };
  }

  private async runAllowedBatch(): Promise<{
    processed: number;
    created: number;
    notificationsSent: number;
  }> {
    let processed = 0;
    let created = 0;
    // 回收 worker 崩溃遗留的 running 任务，否则它们会永远卡在 running 状态。
    await this.jobs.requeueStale(10 * 60_000);

    // 订阅/保单到期提醒不走 background_jobs：应发时刻由档案数据算出，改配置就该立刻反映，
    // 排队的 job 反而要在每个改动路径上回收。扫表 + dedupeKey 幂等更省心（见 ReminderSchedulerService）。
    // 扫描抛错不能拖垮 job 循环，两者互不依赖；两类扫描也各自 try，一边挂了另一边照常发。
    try {
      await this.reminderScheduler.scanSubscriptions();
    } catch (error) {
      console.error("fin-nest-worker subscription reminder scan failed:", error);
    }
    try {
      await this.reminderScheduler.scanInsurances();
    } catch (error) {
      console.error("fin-nest-worker insurance reminder scan failed:", error);
    }
    try {
      await this.reminderScheduler.scanEntryReminders();
    } catch (error) {
      console.error("fin-nest-worker entry reminder scan failed:", error);
    }
    // 汇率每天刷新一次（只请求在用的外币；未启用数据源时直接跳过）。放在 job 循环之前：
    // 自动记账生成待确认时按当日汇率折算本币，只查库不联网，靠这里先把汇率备好。
    if (
      this.fx.providerEnabled &&
      this.fxRefreshedOn !== todayKey() &&
      Date.now() >= this.fxRetryAfter
    ) {
      try {
        const { written, failed } = await this.fx.refreshLatestInUse();
        if (failed === 0) this.fxRefreshedOn = todayKey();
        else this.fxRetryAfter = Date.now() + 60 * 60_000;
        if (written > 0) console.log(`fin-nest-worker refreshed ${written} exchange rates`);
      } catch (error) {
        this.fxRetryAfter = Date.now() + 60 * 60_000;
        console.error("fin-nest-worker exchange rate refresh failed:", error);
      }
    }
    // 周期备份同样是扫表判定：周期配置随时可改，排好的 job 每次改动都要回收，得不偿失。
    // worker 会等周期备份结束，避免进程在容器停止时把半截归档一起砍掉。
    try {
      const backup = await this.systemBackup.runScheduled();
      if (backup.started) {
        console.log(`fin-nest-worker scheduled backup started (pruned=${backup.pruned})`);
      }
    } catch (error) {
      console.error("fin-nest-worker scheduled backup failed:", error);
    }
    while (true) {
      const job = await this.jobs.claimNext(`worker-${process.pid}`);
      if (!job) break;
      try {
        if (job.type === "auto.schedule") {
          const result = await this.autoScheduler.generateDuePending(
            this.autoSchedulerPayload(job.payload),
          );
          created += result.created;
          // 刚生成的待确认立即入队推送；实际发送在本轮末尾统一 dispatch。
          await this.reminderScheduler.enqueueForPendings(result.createdIds);
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

    // 派发放在 job 循环之后：自动记账的待确认是在循环里生成并入队的，
    // 放在前面就要等下一轮（默认 30s）才发得出去。
    let notificationsSent = 0;
    try {
      notificationsSent = (await this.notifications.dispatchPending()).sent;
    } catch (error) {
      console.error("fin-nest-worker notification dispatch failed:", error);
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
