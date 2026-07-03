import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { BackupService } from "./backup.service";
import { ExcelExportService } from "./excel-export.service";
import { ExcelImportService } from "./excel-import.service";
import { ExportController } from "./export.controller";
import { ImportController } from "./import.controller";

@Module({
  imports: [AuthModule, LedgersModule, TransactionsModule],
  controllers: [ExportController, ImportController],
  providers: [BackupService, ExcelExportService, ExcelImportService],
})
export class DataTransferModule {}
