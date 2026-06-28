import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [AuthModule, LedgersModule, AccountsModule, FilesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
