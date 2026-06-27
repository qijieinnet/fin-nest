import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from "./auth.constants";
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
  @ApiCreatedResponse({ description: "注册并创建登录 session" })
  async register(
    @Body() body: RegisterDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(body, request);
    this.setSessionCookie(response, result.token, result.expiresAt);
    return result;
  }

  @Post("login")
  @ApiOkResponse({ description: "登录并创建登录 session" })
  async login(
    @Body() body: LoginDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body, request);
    this.setSessionCookie(response, result.token, result.expiresAt);
    return result;
  }

  @Post("logout")
  @ApiBearerAuth()
  @ApiNoContentResponse()
  @UseGuards(SessionAuthGuard)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(auth as SessionAuthContext);
    response.clearCookie(SESSION_COOKIE_NAME);
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

  private setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });
  }
}
