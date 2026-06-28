import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [AuthModule, LedgersModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
