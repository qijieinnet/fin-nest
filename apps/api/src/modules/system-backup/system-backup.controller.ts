import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import {
  AppError,
  BACKUP_FILE_PREFIX,
  BACKUP_TEMP_SUFFIX,
  resolveBackupDir,
  SystemBackupService,
} from "@fin-nest/backend";
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
/**
 * 导入上传的归档上限。
 *
 * 系统备份含全部附件原文，上 GB 很正常，所以不能套用附件那 20MB 的限制。取 64GB 是
 * 「别让一个坏掉的请求把备份盘写满」的兜底，真正的约束是备份卷本身的容量。
 */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024 * 1024;

/**
 * 上传直接落在**备份目录**里的 `.part`。
 *
 * 不走系统临时目录：一份上 GB 的归档转正时就得整份拷过来（docker 里 /tmp 与备份卷
 * 往往还不是同一个设备，rename 会直接 EXDEV 失败）。写在目标目录里，转正只是一次同盘
 * rename；`.part` 不进备份列表，中途放弃的残留由 pruneStaleTempArchives 收走。
 */
const importStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = resolveBackupDir();
    mkdir(dir, { recursive: true }).then(
      () => cb(null, dir),
      (error: Error) => cb(error, dir),
    );
  },
  filename: (_req, _file, cb) =>
    cb(null, `${BACKUP_FILE_PREFIX}import-${randomUUID()}${BACKUP_TEMP_SUFFIX}`),
});

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

  @Post("import")
  @UseInterceptors(
    FileInterceptor("file", { storage: importStorage, limits: { fileSize: MAX_IMPORT_BYTES } }),
  )
  @ApiCreatedResponse({ description: "导入外部备份归档（校验后收进备份目录，可随后执行恢复）" })
  async importArchive(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new AppError("BACKUP_FILE_REQUIRED", "请选择要导入的备份文件", 400);
    return this.backups.importArchive(
      {
        tempPath: file.path,
        // multer 给的是 latin1 解出来的字节，中文文件名要按 UTF-8 还原才不是乱码。
        originalName: Buffer.from(file.originalname, "latin1").toString("utf-8"),
      },
      (auth as SessionAuthContext).userId,
    );
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
