import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { FxRateQueryDto } from "./dto/fx-rate-query.dto";
import { UpsertFxRateDto } from "./dto/upsert-fx-rate.dto";
import { FxService } from "./fx.service";

@ApiTags("fx")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/fx")
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get("rate")
  @ApiOkResponse({ description: "查询某天的汇率（1 from = rate to），取不到时 quote 为 null" })
  rate(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: FxRateQueryDto,
  ) {
    return this.fx.rate(ledgerId, (auth as SessionAuthContext).userId, query);
  }

  @Get("rates")
  @ApiOkResponse({ description: "本账本在用外币的最新汇率与手填记录" })
  overview(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.fx.overview(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Put("rates")
  @ApiOkResponse({ description: "手填 / 覆盖某天的汇率（1 外币 = rate 本币）" })
  upsert(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UpsertFxRateDto,
  ) {
    return this.fx.upsertManual(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Delete("rates/:rateId")
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("rateId") rateId: string,
  ) {
    return this.fx.deleteManual(ledgerId, (auth as SessionAuthContext).userId, rateId);
  }
}
