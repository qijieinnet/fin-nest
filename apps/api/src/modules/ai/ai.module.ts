import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { RecordsModule } from "../records/records.module";
import { StatsModule } from "../stats/stats.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [AuthModule, LedgersModule, RecordsModule, AccountsModule, TransactionsModule, StatsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
