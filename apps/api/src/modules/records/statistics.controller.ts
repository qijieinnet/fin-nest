import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { StatisticsQueryDto } from "./dto/statistics-query.dto";
import { RecordsService } from "./records.service";

@ApiTags("statistics")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/statistics")
export class StatisticsController {
  constructor(private readonly records: RecordsService) {}

  @Get("overview")
  @ApiOkResponse()
  overview(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: StatisticsQueryDto,
  ) {
    return this.records.getStatistics(ledgerId, (auth as SessionAuthContext).userId, query);
  }
}
