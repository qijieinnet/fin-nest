import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AutomationService } from "./automation.service";
import { CreateQuickTemplateDto, UpdateQuickTemplateDto } from "./dto/quick-template.dto";

@ApiTags("quick-templates")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/quick-templates")
export class QuickTemplatesController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.automation.listTemplates(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateQuickTemplateDto,
  ) {
    return this.automation.createTemplate(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch(":templateId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("templateId") templateId: string,
    @Body() body: UpdateQuickTemplateDto,
  ) {
    return this.automation.updateTemplate(ledgerId, templateId, (auth as SessionAuthContext).userId, body);
  }

  @Get(":templateId/prefill")
  @ApiOkResponse()
  prefill(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("templateId") templateId: string,
  ) {
    return this.automation.prefillTemplate(ledgerId, templateId, (auth as SessionAuthContext).userId);
  }

  @Post(":templateId/run")
  @ApiOkResponse()
  run(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("templateId") templateId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.automation.runTemplate(
      ledgerId,
      templateId,
      (auth as SessionAuthContext).userId,
      idempotencyKey,
    );
  }

  @Delete(":templateId")
  @ApiNoContentResponse()
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("templateId") templateId: string,
  ): Promise<void> {
    await this.automation.archiveTemplate(ledgerId, templateId, (auth as SessionAuthContext).userId);
  }
}
