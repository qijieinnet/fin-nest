import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { BudgetsController } from "./budgets.controller";
import { PlanShareTokenService } from "./plan-share-token.service";
import { PlansController } from "./plans.controller";
import { PlansService } from "./plans.service";
import { PublicPlansController } from "./public-plans.controller";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [PlansController, BudgetsController, PublicPlansController],
  providers: [PlansService, PlanShareTokenService],
  exports: [PlansService],
})
export class PlansModule {}
