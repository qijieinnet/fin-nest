import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AutomationService } from "./automation.service";
import { CreateAutoRuleDto, UpdateAutoRuleDto } from "./dto/auto-rule.dto";

@ApiTags("auto-rules")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/auto-rules")
export class AutoRulesController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.automation.listRules(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreateAutoRuleDto) {
    return this.automation.createRule(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch(":ruleId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: UpdateAutoRuleDto,
  ) {
    return this.automation.updateRule(ledgerId, ruleId, (auth as SessionAuthContext).userId, body);
  }

  @Delete(":ruleId")
  @ApiNoContentResponse()
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("ruleId") ruleId: string,
  ): Promise<void> {
    await this.automation.archiveRule(ledgerId, ruleId, (auth as SessionAuthContext).userId);
  }
}
