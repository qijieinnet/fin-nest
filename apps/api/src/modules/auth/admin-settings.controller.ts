import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext, SessionAuthContext } from "./auth.types";
import { UpdateRegistrationSettingDto } from "./dto/update-registration-setting.dto";
import { AdminGuard, SessionAuthGuard } from "./session-auth.guard";

@ApiTags("admin-settings")
@ApiBearerAuth()
@Controller("admin/app-settings")
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminSettingsController {
  constructor(private readonly authService: AuthService) {}

  @Get("registration")
  @ApiOkResponse({ description: "读取注册开关" })
  getRegistrationSetting() {
    return this.authService.getRegistrationSetting();
  }

  @Patch("registration")
  @ApiOkResponse({ description: "更新注册开关" })
  updateRegistrationSetting(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateRegistrationSettingDto,
  ) {
    return this.authService.updateRegistrationSetting(
      body.registrationEnabled,
      auth as SessionAuthContext,
    );
  }
}
