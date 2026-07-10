import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PrismaService, todayKey } from "@fin-nest/backend";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { BackupService } from "./backup.service";
import { ExcelExportService } from "./excel-export.service";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@ApiTags("data-transfer")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/export")
export class ExportController {
  constructor(
    private readonly backup: BackupService,
    private readonly excel: ExcelExportService,
    private readonly prisma: PrismaService,
  ) {}

  // 导出端点用 @Res() 直接写响应：全局 BigIntSerializeInterceptor 会把
  // StreamableFile/Buffer 当普通对象展开，走拦截器会损坏文件。

  @Get("json")
  @ApiOkResponse({ description: "JSON 备份文件下载" })
  async exportJson(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Res() res: Response,
  ): Promise<void> {
    const envelope = await this.backup.exportJson(ledgerId, (auth as SessionAuthContext).userId);
    const filename = await this.buildFilename(ledgerId, "备份", "json");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", contentDisposition(filename));
    res.send(Buffer.from(JSON.stringify(envelope, null, 2), "utf-8"));
  }

  @Get("excel")
  @ApiOkResponse({ description: "Excel 全量导出下载" })
  async exportExcel(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.excel.buildWorkbook(ledgerId, (auth as SessionAuthContext).userId, { template: false });
    const filename = await this.buildFilename(ledgerId, "导出", "xlsx");
    res.setHeader("content-type", XLSX_MIME);
    res.setHeader("content-disposition", contentDisposition(filename));
    res.send(buffer);
  }

  @Get("excel-template")
  @ApiOkResponse({ description: "Excel 记账模板下载" })
  async exportExcelTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.excel.buildWorkbook(ledgerId, (auth as SessionAuthContext).userId, { template: true });
    const filename = await this.buildFilename(ledgerId, "模板", "xlsx");
    res.setHeader("content-type", XLSX_MIME);
    res.setHeader("content-disposition", contentDisposition(filename));
    res.send(buffer);
  }

  private async buildFilename(ledgerId: string, kind: string, ext: string): Promise<string> {
    const ledger = await this.prisma.client.ledger.findFirst({ where: { id: ledgerId }, select: { name: true } });
    return `fin-nest-${kind}-${ledger?.name ?? "账本"}-${todayKey()}.${ext}`;
  }
}

/** 文件名含中文，用 RFC 5987 filename* 编码，另给纯 ASCII 的 filename 兜底。 */
function contentDisposition(filename: string): string {
  // 引号/反斜杠会破坏 header 的 quoted-string 格式（账本名用户可控），一并替换。
  const fallback = filename.replace(/["\r\n\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
