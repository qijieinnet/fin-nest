import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AgentTokenService } from "./agent-token.service";
import { CreateAgentTokenDto, UpdateAgentTokenDto } from "./dto/agent-token.dto";

/** 个人智能体 token：每人只管理自己的，不需要管理员。 */
@ApiTags("agent-tokens")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("auth/agent-tokens")
export class AgentTokensController {
  constructor(private readonly tokens: AgentTokenService) {}

  @Get()
  @ApiOkResponse({ description: "列出我的智能体 token（不含明文）" })
  list(@CurrentAuth() auth: AuthContext) {
    return this.tokens.list((auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse({ description: "创建智能体 token，明文仅在本次响应返回" })
  create(@CurrentAuth() auth: AuthContext, @Body() body: CreateAgentTokenDto) {
    return this.tokens.create((auth as SessionAuthContext).userId, body);
  }

  @Patch(":tokenId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("tokenId", new ParseUUIDPipe()) tokenId: string,
    @Body() body: UpdateAgentTokenDto,
  ) {
    return this.tokens.update((auth as SessionAuthContext).userId, tokenId, body);
  }

  @Delete(":tokenId")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "吊销 token（不物理删除）" })
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param("tokenId", new ParseUUIDPipe()) tokenId: string,
  ): Promise<void> {
    await this.tokens.revoke((auth as SessionAuthContext).userId, tokenId);
  }
}
