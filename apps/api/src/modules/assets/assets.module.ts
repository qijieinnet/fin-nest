import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { AssetsService } from "./assets.service";
import { InsurancesController } from "./insurances.controller";
import { ItemsController } from "./items.controller";
import { SubscriptionsController } from "./subscriptions.controller";

@Module({
  imports: [AuthModule, LedgersModule, FilesModule],
  controllers: [InsurancesController, ItemsController, SubscriptionsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
