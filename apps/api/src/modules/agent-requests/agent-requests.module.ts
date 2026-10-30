import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AuthModule } from "../auth/auth.module";
import { AutomationModule } from "../automation/automation.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AgentChangeRequestsController } from "./agent-requests.controller";
import { AgentChangeRequestsService } from "./agent-requests.service";

/** 智能体变更申请（docs/MCP_PLAN.md §6）：MCP 提交，用户在应用内批准/驳回。 */
@Module({
  imports: [AuthModule, LedgersModule, TransactionsModule, AccountsModule, AutomationModule],
  controllers: [AgentChangeRequestsController],
  providers: [AgentChangeRequestsService],
  exports: [AgentChangeRequestsService],
})
export class AgentRequestsModule {}
