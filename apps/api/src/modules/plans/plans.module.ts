import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { BudgetsController } from "./budgets.controller";
import { PlansController } from "./plans.controller";
import { PlansService } from "./plans.service";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [PlansController, BudgetsController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
