import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { AutomationModule } from "../automation/automation.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { PlansModule } from "../plans/plans.module";
import { RecordsModule } from "../records/records.module";
import { RemindersModule } from "../reminders/reminders.module";
import { StatsModule } from "../stats/stats.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [
    AuthModule,
    LedgersModule,
    RecordsModule,
    AccountsModule,
    TransactionsModule,
    StatsModule,
    PlansModule,
    AssetsModule,
    AutomationModule,
    RemindersModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
