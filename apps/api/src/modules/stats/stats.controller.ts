import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CashflowQueryDto } from "./dto/cashflow-query.dto";
import { NetWorthQueryDto } from "./dto/net-worth-query.dto";
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

  @Get("net-worth")
  @ApiOkResponse({ description: "净资产走势（近1周/近1个月/近6个月/近1年）" })
  netWorth(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: NetWorthQueryDto,
  ) {
    return this.stats.netWorthSeries(
      ledgerId,
      (auth as SessionAuthContext).userId,
      query.range ?? "month6",
      query.groupBy === "person",
    );
  }

  @Get("cashflow")
  @ApiOkResponse({ description: "收支走势（近1周/近1个月/近6个月/近1年）" })
  cashflow(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: CashflowQueryDto,
  ) {
    return this.stats.cashflowSeries(
      ledgerId,
      (auth as SessionAuthContext).userId,
      query,
      query.range ?? "month6",
    );
  }
}
