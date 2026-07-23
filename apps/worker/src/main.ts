import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig, loadDotenv } from "@fin-nest/config";
import { WorkerModule } from "./worker.module";
import { WorkerRunnerService } from "./worker-runner.service";

// 常驻进程：轮询处理到期的后台任务（自动记账生成、文件删除重试等）。
// 设置 WORKER_RUN_ONCE=true 可单次运行后退出（调试/外部 cron 场景）。
async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig();
  const runOnce = process.env.WORKER_RUN_ONCE === "true";

  const app = await NestFactory.createApplicationContext(WorkerModule);
  await app.init();
  const runner = app.get(WorkerRunnerService);

  let stopped = false;
  const requestStop = (signal: string) => {
    console.log(`fin-nest-worker received ${signal}, stopping after current batch`);
    stopped = true;
  };
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  console.log(
    `fin-nest-worker started (pollIntervalMs=${config.WORKER_POLL_INTERVAL_MS}, runOnce=${runOnce})`,
  );

  do {
    try {
      const result = await runner.runOnce();
      if (result.processed > 0 || result.notificationsSent > 0) {
        console.log(
          `fin-nest-worker processed=${result.processed} autoPendingCreated=${result.created} notificationsSent=${result.notificationsSent}`,
        );
      }
    } catch (error) {
      console.error("fin-nest-worker run failed:", error);
    }
    if (runOnce || stopped) break;
    await sleep(config.WORKER_POLL_INTERVAL_MS);
  } while (!stopped);

  await app.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void bootstrap();
