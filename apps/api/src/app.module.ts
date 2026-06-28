import { Module } from "@nestjs/common";
import { BackendPlatformModule } from "@fin-nest/backend";
import { HealthController } from "./health/health.controller";
import { AccountsModule } from "./modules/accounts/accounts.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AutomationModule } from "./modules/automation/automation.module";
import { AuthModule } from "./modules/auth/auth.module";
import { LedgersModule } from "./modules/ledgers/ledgers.module";
import { PlansModule } from "./modules/plans/plans.module";
import { RecordsModule } from "./modules/records/records.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";

/**
 * 根模块。
 * 业务模块（auth / ledgers / transactions ...）在 B1 起按 BACKEND_ENGINEERING.md 分层接入。
 */
@Module({
  imports: [
    BackendPlatformModule,
    AuthModule,
    LedgersModule,
    AccountsModule,
    AssetsModule,
    AutomationModule,
    TransactionsModule,
    RecordsModule,
    PlansModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
