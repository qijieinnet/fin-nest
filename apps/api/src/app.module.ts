import { Module } from "@nestjs/common";
import { BackendPlatformModule } from "@fin-nest/backend";
import { HealthController } from "./health/health.controller";
import { AccountsModule } from "./modules/accounts/accounts.module";
import { AiModule } from "./modules/ai/ai.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AutomationModule } from "./modules/automation/automation.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DataTransferModule } from "./modules/data-transfer/data-transfer.module";
import { FilesModule } from "./modules/files/files.module";
import { LedgersModule } from "./modules/ledgers/ledgers.module";
import { PlansModule } from "./modules/plans/plans.module";
import { RecordsModule } from "./modules/records/records.module";
import { RemindersModule } from "./modules/reminders/reminders.module";
import { StatsModule } from "./modules/stats/stats.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";

/**
 * 根模块。
 * 业务模块（auth / ledgers / transactions ...）按「Controller 薄、业务在 Service」分层接入（见 docs/PROJECT_GUIDE.md）。
 */
@Module({
  imports: [
    BackendPlatformModule,
    AuthModule,
    LedgersModule,
    AccountsModule,
    AiModule,
    AssetsModule,
    AutomationModule,
    DataTransferModule,
    FilesModule,
    TransactionsModule,
    RecordsModule,
    PlansModule,
    RemindersModule,
    StatsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
