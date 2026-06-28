import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { RemindersController } from "./reminders.controller";
import { RemindersService } from "./reminders.service";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
