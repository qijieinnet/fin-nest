import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@fin-nest/config";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  await app.init();
  console.log("fin-nest-worker started");
}

void bootstrap();
