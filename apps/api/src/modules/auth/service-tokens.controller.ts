import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext, SessionAuthContext } from "./auth.types";
import { CreateServiceTokenDto } from "./dto/create-service-token.dto";
import { AdminGuard, SessionAuthGuard } from "./session-auth.guard";
import { ServiceTokenService } from "./service-token.service";

@ApiTags("service-tokens")
@ApiBearerAuth()
@Controller("service-tokens")
@UseGuards(SessionAuthGuard, AdminGuard)
export class ServiceTokensController {
  constructor(private readonly serviceTokens: ServiceTokenService) {}

  @Post()
  @ApiCreatedResponse({ description: "创建 service token，明文 token 仅返回一次" })
  create(@CurrentAuth() auth: AuthContext, @Body() body: CreateServiceTokenDto) {
    return this.serviceTokens.create(body, auth as SessionAuthContext);
  }

  @Get()
  @ApiOkResponse({ description: "列出 service token 元数据，不返回明文 token" })
  list() {
    return this.serviceTokens.list();
  }

  @Delete(":id")
  @ApiNoContentResponse()
  async revoke(@CurrentAuth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    await this.serviceTokens.revoke(id, auth as SessionAuthContext);
  }
}
