import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthContext, RequestWithAuth, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { FeishuBindTicketDto, FeishuSilentLoginDto } from "./dto/feishu-silent-login.dto";
import { FeishuWebLoginService } from "./feishu-web-login.service";

/**
 * 飞书容器内免登。挂在 `auth/feishu` 而非 `feishu` 下，是因为这两个接口属于登录流程：
 * `config` / `silent-login` 必须在未登录时可访问，与 `FeishuBindController` 的全局 session 守卫互斥。
 */
@ApiTags("auth")
@Controller("auth/feishu")
export class FeishuWebLoginController {
  constructor(private readonly webLogin: FeishuWebLoginService) {}

  @Get("config")
  @ApiOkResponse({ description: "公开：是否启用免登及 App ID，供前端拼授权跳转地址" })
  config() {
    return this.webLogin.publicConfig();
  }

  @Post("silent-login")
  @ApiOkResponse({
    description: "用飞书授权码换登录态；该飞书号未绑定本地账号时返回待绑定票据",
  })
  silentLogin(@Body() body: FeishuSilentLoginDto, @Req() request: RequestWithAuth) {
    return this.webLogin.silentLogin(body, request);
  }

  @Post("bind")
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: "登录后消费待绑定票据，把飞书号绑到当前账号" })
  @UseGuards(SessionAuthGuard)
  bind(@CurrentAuth() auth: AuthContext, @Body() body: FeishuBindTicketDto) {
    return this.webLogin.completeBind(body.ticket, (auth as SessionAuthContext).userId);
  }
}
