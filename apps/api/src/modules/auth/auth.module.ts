import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminUsersController } from "./admin-users.controller";
import { AppLockController } from "./app-lock.controller";
import { AppLockService } from "./app-lock.service";
import { AuthService } from "./auth.service";
import { AdminGuard, SessionAuthGuard } from "./session-auth.guard";
import { ServiceTokenService } from "./service-token.service";
import { ServiceTokensController } from "./service-tokens.controller";

@Module({
  controllers: [
    AuthController,
    AppLockController,
    AdminSettingsController,
    AdminUsersController,
    ServiceTokensController,
  ],
  providers: [AuthService, AppLockService, ServiceTokenService, SessionAuthGuard, AdminGuard],
  exports: [AuthService, ServiceTokenService, SessionAuthGuard, AdminGuard],
})
export class AuthModule {}
