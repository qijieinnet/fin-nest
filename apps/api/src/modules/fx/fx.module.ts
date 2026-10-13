import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { FxController } from "./fx.controller";
import { FxService } from "./fx.service";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [FxController],
  providers: [FxService],
})
export class FxModule {}
