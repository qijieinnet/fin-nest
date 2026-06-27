import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { CategoriesController } from "./categories.controller";
import { PeopleController } from "./people.controller";
import { RecordSettingsController } from "./record-settings.controller";
import { RecordsService } from "./records.service";
import { StatisticsController } from "./statistics.controller";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [CategoriesController, PeopleController, RecordSettingsController, StatisticsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
