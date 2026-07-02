import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { StatsQueryDto } from "./dto/stats-query.dto";
import { StatsService } from "./stats.service";

@ApiTags("stats")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/stats")
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @ApiOkResponse({ description: "月度分类收支统计与近 6 个月趋势" })
  monthly(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.stats.monthly(ledgerId, (auth as SessionAuthContext).userId, query);
  }
}
