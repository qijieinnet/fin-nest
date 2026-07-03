import {
  Body,
  Controller,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AppError } from "@fin-nest/backend";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { BackupService } from "./backup.service";
import { ExcelImportService } from "./excel-import.service";
import { ImportExcelQueryDto } from "./dto/import-excel-query.dto";
import { RestoreJsonDto } from "./dto/restore-json.dto";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// 备份 JSON 会超过 Express 默认 100KB body 限制，导入统一走 multipart 文件上传。
const fileInterceptor = FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } });

@ApiTags("data-transfer")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/import")
export class ImportController {
  constructor(
    private readonly backup: BackupService,
    private readonly excelImport: ExcelImportService,
  ) {}

  @Post("json")
  @UseInterceptors(fileInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        confirmLedgerName: { type: "string" },
      },
    },
  })
  @ApiOkResponse({ description: "覆盖恢复 JSON 备份（仅账本所有者）" })
  restoreJson(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: RestoreJsonDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new AppError("IMPORT_FILE_REQUIRED", "缺少上传文件", 400);
    return this.backup.restoreJson(
      ledgerId,
      (auth as SessionAuthContext).userId,
      file.buffer,
      body.confirmLedgerName,
    );
  }

  @Post("excel")
  @UseInterceptors(fileInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiOkResponse({ description: "Excel 增量导入；dryRun=true 只返回预览" })
  importExcel(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ImportExcelQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new AppError("IMPORT_FILE_REQUIRED", "缺少上传文件", 400);
    return this.excelImport.importExcel(
      ledgerId,
      (auth as SessionAuthContext).userId,
      file.buffer,
      query.dryRun ?? true,
    );
  }
}
