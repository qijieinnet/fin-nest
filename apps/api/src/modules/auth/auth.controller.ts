import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext, RequestWithAuth, SessionAuthContext } from "./auth.types";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { SessionAuthGuard } from "./session-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @ApiCreatedResponse({ description: "注册并创建登录 session，token 由客户端保存并放请求头" })
  async register(@Body() body: RegisterDto, @Req() request: RequestWithAuth) {
    return this.authService.register(body, request);
  }

  @Post("login")
  @ApiOkResponse({ description: "登录并创建登录 session，token 由客户端保存并放请求头" })
  async login(@Body() body: LoginDto, @Req() request: RequestWithAuth) {
    return this.authService.login(body, request);
  }

  @Post("logout")
  @ApiBearerAuth()
  @ApiNoContentResponse()
  @UseGuards(SessionAuthGuard)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.authService.logout(auth as SessionAuthContext);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard)
  me(@CurrentAuth() auth: AuthContext) {
    return this.authService.me(auth as SessionAuthContext);
  }

  @Patch("password")
  @ApiBearerAuth()
  @ApiNoContentResponse()
  @UseGuards(SessionAuthGuard)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(
      auth as SessionAuthContext,
      body.currentPassword,
      body.newPassword,
    );
  }
}
