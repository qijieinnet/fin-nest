import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig, loadDotenv } from "@fin-nest/config";
import { WorkerModule } from "./worker.module";
import { WorkerRunnerService } from "./worker-runner.service";

async function bootstrap(): Promise<void> {
  loadDotenv();
  loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  await app.init();
  const result = await app.get(WorkerRunnerService).runOnce();
  console.log(`fin-nest-worker processed=${result.processed} autoPendingCreated=${result.created}`);
  await app.close();
}

void bootstrap();
