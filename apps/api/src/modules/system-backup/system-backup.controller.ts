import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AppError, SystemBackupService } from "@fin-nest/backend";
import type { Response } from "express";
import { AuthService } from "../auth/auth.service";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AdminGuard, SessionAuthGuard } from "../auth/session-auth.guard";
import { RestoreBackupDto, UpdateBackupSettingDto } from "./dto/system-backup.dto";

/**
 * 系统级备份（管理员功能 › 自动备份）。
 *
 * 备份与恢复都是长任务，接口只负责「校验 + 建台账行 + 触发」，随后立即返回；
 * 前端轮询 `GET /admin/backups` 拿状态。恢复会清空全部业务数据，因此额外要求管理员输入自己的登录密码。
 */
@ApiTags("system-backup")
@ApiBearerAuth()
@Controller("admin/backups")
@UseGuards(SessionAuthGuard, AdminGuard)
export class SystemBackupController {
  constructor(
    private readonly backups: SystemBackupService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiOkResponse({ description: "备份目录状态、周期配置、备份列表与最近一次恢复" })
  async overview() {
    const [directory, setting, items, backup, restore] = await Promise.all([
      this.backups.ensureDirectory(),
      this.backups.getSetting(),
      this.backups.listArchives(),
      this.backups.latestBackup(),
      this.backups.latestRestore(),
    ]);
    return { directory, setting, items, backup, restore };
  }

  @Post()
  @ApiOkResponse({ description: "立即备份（后台执行，返回 running 台账行）" })
  createBackup(@CurrentAuth() auth: AuthContext) {
    return this.backups.startBackup({
      trigger: "manual",
      userId: (auth as SessionAuthContext).userId,
    });
  }

  @Patch("settings")
  @ApiOkResponse({ description: "更新周期备份配置" })
  updateSetting(@CurrentAuth() auth: AuthContext, @Body() body: UpdateBackupSettingDto) {
    return this.backups.updateSetting(body, (auth as SessionAuthContext).userId);
  }

  @Get(":fileName/download")
  @ApiOkResponse({ description: "下载备份归档" })
  async download(@Param("fileName") fileName: string, @Res() res: Response): Promise<void> {
    // 下载走 @Res() 直写：全局 BigIntSerializeInterceptor 会把流当普通对象展开，损坏文件。
    const path = this.backups.archivePath(fileName);
    const info = await stat(path).catch(() => null);
    if (!info) throw new AppError("BACKUP_FILE_NOT_FOUND", "备份文件不存在", 404);
    res.setHeader("content-type", "application/zip");
    res.setHeader("content-length", info.size.toString());
    res.setHeader("content-disposition", `attachment; filename="${fileName}"`);
    createReadStream(path).pipe(res);
  }

  @Delete(":fileName")
  @HttpCode(204)
  @ApiOkResponse({ description: "删除备份归档" })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param("fileName") fileName: string,
  ): Promise<void> {
    await this.backups.deleteArchive(fileName, (auth as SessionAuthContext).userId);
  }

  @Post(":fileName/restore")
  @ApiOkResponse({ description: "用该归档覆盖恢复全系统（需管理员密码二次确认）" })
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param("fileName") fileName: string,
    @Body() body: RestoreBackupDto,
  ) {
    const session = auth as SessionAuthContext;
    // 密码校验复用应用锁那条路径：带按用户维度的失败限速，挡住拿着有效 token 爆破密码。
    await this.authService.verifyCurrentPassword(session, body.password);
    return this.backups.startRestore({
      fileName,
      userId: session.userId,
      sessionId: session.sessionId,
    });
  }
}
