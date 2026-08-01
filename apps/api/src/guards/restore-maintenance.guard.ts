import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AppError, SystemBackupService } from "@fin-nest/backend";
import type { Request } from "express";

/**
 * 系统恢复期间的全局维护门禁。
 *
 * 恢复从归档预检开始就会留下 running 台账。除健康检查和管理员的进度查询外，API 暂停普通
 * 请求，避免旧系统的长请求/worker 在原子切换后继续向恢复出来的数据写入。
 */
@Injectable()
export class RestoreMaintenanceGuard implements CanActivate {
  constructor(private readonly backups: SystemBackupService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "OPTIONS" || request.path === "/health") return true;
    if (request.method === "GET" && request.path.startsWith("/admin/backups")) return true;
    if (!(await this.backups.isRestoreRunning())) return true;
    throw new AppError(
      "SYSTEM_RESTORE_IN_PROGRESS",
      "系统正在恢复数据，请等待管理员操作完成后重试",
      503,
    );
  }
}
