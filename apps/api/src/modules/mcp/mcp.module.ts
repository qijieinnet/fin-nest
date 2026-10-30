import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AgentRequestsModule } from "../agent-requests/agent-requests.module";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { AutomationModule } from "../automation/automation.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { PlansModule } from "../plans/plans.module";
import { RecordsModule } from "../records/records.module";
import { RemindersModule } from "../reminders/reminders.module";
import { StatsModule } from "../stats/stats.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AgentTokenService } from "./agent-token.service";
import { AgentTokensController } from "./agent-tokens.controller";
import { McpChangeToolsService } from "./mcp-change-tools.service";
import { McpRuntime } from "./mcp-common";
import { McpController } from "./mcp.controller";
import { McpToolsService } from "./mcp-tools.service";
import { McpWriteToolsService } from "./mcp-write-tools.service";

/**
 * 外部智能体接入（MCP，见 docs/MCP_PLAN.md）：个人 token 管理 + `/mcp` 端点。
 * 工具在进程内直接调用领域 service，不经 REST controller（那一层写死了 session 鉴权）。
 */
@Module({
  imports: [
    AuthModule,
    AgentRequestsModule,
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
  controllers: [AgentTokensController, McpController],
  providers: [
    AgentTokenService,
    McpRuntime,
    McpToolsService,
    McpWriteToolsService,
    McpChangeToolsService,
  ],
})
export class McpModule {}
