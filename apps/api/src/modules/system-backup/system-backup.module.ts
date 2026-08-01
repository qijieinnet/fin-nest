import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SystemBackupController } from "./system-backup.controller";

/**
 * 系统级备份的 API 入口。
 * 备份/恢复的实现在 `@fin-nest/backend` 的 `SystemBackupService`（worker 的周期备份用同一份）。
 */
@Module({
  imports: [AuthModule],
  controllers: [SystemBackupController],
})
export class SystemBackupModule {}
