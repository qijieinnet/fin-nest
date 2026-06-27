import { Module } from "@nestjs/common";

/**
 * Worker 根模块。
 * 与 api 共享领域代码，作为独立进程消费 background_jobs（自动记账调度、附件清理重试等，见 B7/B9）。
 */
@Module({})
export class WorkerModule {}
