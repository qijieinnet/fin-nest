import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AutoPendingController } from "./auto-pending.controller";
import { AutoRulesController } from "./auto-rules.controller";
import { AutomationService } from "./automation.service";
import { QuickTemplatesController } from "./quick-templates.controller";

@Module({
  imports: [AuthModule, LedgersModule, TransactionsModule],
  controllers: [AutoRulesController, AutoPendingController, QuickTemplatesController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
