import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";

/**
 * 根模块。
 * 业务模块（auth / ledgers / transactions ...）在 B1 起按 BACKEND_ENGINEERING.md 分层接入。
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
