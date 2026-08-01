import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext, SessionAuthContext } from "./auth.types";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UpdateUserAdminDto } from "./dto/update-user-admin.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { AdminGuard, SessionAuthGuard } from "./session-auth.guard";

@ApiTags("admin-users")
@ApiBearerAuth()
@Controller("admin/users")
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOkResponse({ description: "分页搜索用户（含禁用状态、管理员标记）" })
  list(@Query() query: ListUsersQueryDto) {
    return this.authService.listUsers({
      search: query.search,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
  }

  @Patch(":id/status")
  @ApiOkResponse({ description: "禁用或启用用户" })
  updateStatus(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Body() body: UpdateUserStatusDto,
  ) {
    return this.authService.setUserDisabled(id, body.disabled, auth as SessionAuthContext);
  }

  @Patch(":id/admin")
  @ApiOkResponse({ description: "设为或取消管理员" })
  updateAdmin(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Body() body: UpdateUserAdminDto,
  ) {
    return this.authService.setUserAdmin(id, body.isAdmin, auth as SessionAuthContext);
  }

  @Get(":id/sessions")
  @ApiOkResponse({ description: "该用户当前在线的登录设备列表" })
  listSessions(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    return this.authService.listUserSessions(id, auth as SessionAuthContext);
  }

  @Delete(":id/sessions/:sessionId")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "下线该用户的某台设备（吊销对应 session）" })
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Param("sessionId") sessionId: string,
  ): Promise<void> {
    await this.authService.revokeUserSession(id, sessionId, auth as SessionAuthContext);
  }
}
