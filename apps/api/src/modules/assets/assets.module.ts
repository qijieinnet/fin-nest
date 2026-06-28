import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { AssetsService } from "./assets.service";
import { InsurancesController } from "./insurances.controller";
import { ItemsController } from "./items.controller";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [InsurancesController, ItemsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
