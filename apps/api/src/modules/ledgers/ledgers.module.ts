import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersController } from "./ledgers.controller";
import { LedgersService } from "./ledgers.service";

@Module({
  imports: [AuthModule],
  controllers: [LedgersController],
  providers: [LedgersService],
  exports: [LedgersService],
})
export class LedgersModule {}
