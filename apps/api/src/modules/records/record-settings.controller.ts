import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { UpdateRecordSettingDto } from "./dto/record-setting.dto";
import { RecordsService } from "./records.service";

@ApiTags("record-settings")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/record-setting")
export class RecordSettingsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse()
  get(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.records.getRecordSetting(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Patch()
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UpdateRecordSettingDto,
  ) {
    return this.records.updateRecordSetting(ledgerId, (auth as SessionAuthContext).userId, body);
  }
}
