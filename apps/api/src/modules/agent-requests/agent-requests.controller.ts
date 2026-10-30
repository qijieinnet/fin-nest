import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AgentChangeRequestsService } from "./agent-requests.service";
import { ListAgentRequestsQueryDto } from "./dto/list-agent-requests-query.dto";

/** 智能体变更申请的人工审批（批准 = 立即执行）。只走 session，MCP 侧没有批准工具。 */
@ApiTags("agent-change-requests")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/agent-change-requests")
export class AgentChangeRequestsController {
  constructor(private readonly requests: AgentChangeRequestsService) {}

  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ListAgentRequestsQueryDto,
  ) {
    return this.requests.list(ledgerId, (auth as SessionAuthContext).userId, query.status);
  }

  @Post(":requestId/approve")
  @HttpCode(200)
  @ApiOkResponse({ description: "批准并立即执行；目标在申请后被改过时拒绝执行" })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
  ) {
    return this.requests.approve(ledgerId, requestId, (auth as SessionAuthContext).userId);
  }

  @Post(":requestId/reject")
  @HttpCode(204)
  @ApiNoContentResponse()
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
  ): Promise<void> {
    await this.requests.reject(ledgerId, requestId, (auth as SessionAuthContext).userId);
  }
}
