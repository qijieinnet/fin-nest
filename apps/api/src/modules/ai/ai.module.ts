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
  // 飞书机器人复用同一套对话与工具调用能力（见 docs/FEISHU_BOT_PLAN.md）。
  exports: [AiService],
})
export class AiModule {}
