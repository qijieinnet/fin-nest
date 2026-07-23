import { Module } from "@nestjs/common";
import { BackendPlatformModule } from "@fin-nest/backend";
import { AutoSchedulerService } from "./automation/auto-scheduler.service";
import { FileDeleteService } from "./files/file-delete.service";
import { ReminderSchedulerService } from "./notifications/reminder-scheduler.service";
import { WorkerRunnerService } from "./worker-runner.service";

/**
 * Worker 根模块。
 * 与 api 共享领域代码，作为独立进程消费 background_jobs（自动记账调度、附件清理重试等，见 B7/B9）。
 */
@Module({
  imports: [BackendPlatformModule],
  providers: [
    AutoSchedulerService,
    FileDeleteService,
    ReminderSchedulerService,
    WorkerRunnerService,
  ],
})
export class WorkerModule {}
