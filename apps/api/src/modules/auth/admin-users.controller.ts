import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
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
}
