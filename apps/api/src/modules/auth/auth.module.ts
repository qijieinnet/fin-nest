import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminUsersController } from "./admin-users.controller";
import { AuthService } from "./auth.service";
import { AdminGuard, SessionAuthGuard } from "./session-auth.guard";
import { ServiceTokenService } from "./service-token.service";
import { ServiceTokensController } from "./service-tokens.controller";

@Module({
  controllers: [AuthController, AdminSettingsController, AdminUsersController, ServiceTokensController],
  providers: [AuthService, ServiceTokenService, SessionAuthGuard, AdminGuard],
  exports: [AuthService, ServiceTokenService, SessionAuthGuard, AdminGuard],
})
export class AuthModule {}
