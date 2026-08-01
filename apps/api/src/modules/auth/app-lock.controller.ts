import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AppLockService } from "./app-lock.service";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext, SessionAuthContext } from "./auth.types";
import {
  RegisterAppLockCredentialDto,
  VerifyAppLockCredentialDto,
} from "./dto/app-lock-credential.dto";
import { UpdateAppLockDto } from "./dto/update-app-lock.dto";
import { SessionAuthGuard } from "./session-auth.guard";

@ApiTags("auth")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("auth/app-lock")
export class AppLockController {
  constructor(private readonly appLock: AppLockService) {}

  @Get()
  @ApiOkResponse({ description: "读取应用锁开关与已注册凭证数量" })
  getStatus(@CurrentAuth() auth: AuthContext) {
    return this.appLock.getStatus(auth as SessionAuthContext);
  }

  @Patch()
  @ApiOkResponse({ description: "开关应用锁；关闭时一并清除已注册的 Face ID / Touch ID 凭证" })
  setEnabled(@CurrentAuth() auth: AuthContext, @Body() body: UpdateAppLockDto) {
    return this.appLock.setEnabled(auth as SessionAuthContext, body.enabled);
  }

  @Post("registration/options")
  @HttpCode(200)
  @ApiOkResponse({ description: "下发 WebAuthn 注册 options（含 challenge）" })
  createRegistrationOptions(@CurrentAuth() auth: AuthContext) {
    return this.appLock.createRegistrationOptions(auth as SessionAuthContext);
  }

  @Post("registration")
  @HttpCode(200)
  @ApiOkResponse({ description: "校验注册断言并保存凭证公钥，成功后应用锁自动开启" })
  confirmRegistration(
    @CurrentAuth() auth: AuthContext,
    @Body() body: RegisterAppLockCredentialDto,
  ) {
    return this.appLock.confirmRegistration(auth as SessionAuthContext, body.response);
  }

  @Post("unlock/options")
  @HttpCode(200)
  @ApiOkResponse({ description: "下发解锁 options；allowCredentials 为空表示该账号只能用密码解锁" })
  createUnlockOptions(@CurrentAuth() auth: AuthContext) {
    return this.appLock.createUnlockOptions(auth as SessionAuthContext);
  }

  @Post("unlock")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "校验解锁断言，失败返回 401" })
  async verifyUnlock(
    @CurrentAuth() auth: AuthContext,
    @Body() body: VerifyAppLockCredentialDto,
  ): Promise<void> {
    await this.appLock.verifyUnlock(auth as SessionAuthContext, body.response);
  }
}
