import { Injectable } from "@nestjs/common";
import { ExcelWorkbookService } from "@fin-nest/backend";
import { LedgersService } from "../ledgers/ledgers.service";

/**
 * 账本 Excel 导出的 API 入口：只负责鉴权，工作簿构建在共享包里
 * （`ExcelWorkbookService`），系统备份的 worker 侧也用同一份实现。
 */
@Injectable()
export class ExcelExportService {
  constructor(
    private readonly ledgers: LedgersService,
    private readonly workbook: ExcelWorkbookService,
  ) {}

  async buildWorkbook(
    ledgerId: string,
    userId: string,
    options: { template: boolean },
  ): Promise<Buffer> {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.workbook.buildWorkbook(ledgerId, options);
  }
}
