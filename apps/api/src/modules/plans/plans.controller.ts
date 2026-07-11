import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CreatePlanDto, UpdatePlanDto } from "./dto/plan.dto";
import { PlanProgressQueryDto } from "./dto/progress-query.dto";
import { PlanShareTokenService } from "./plan-share-token.service";
import { PlansService } from "./plans.service";

@ApiTags("plans")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/plans")
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly shareTokens: PlanShareTokenService,
  ) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.plans.listPlans(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get("stopped")
  @ApiOkResponse()
  stopped(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.plans.listStoppedPlans(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreatePlanDto) {
    return this.plans.createPlan(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch(":planId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
    @Body() body: UpdatePlanDto,
  ) {
    return this.plans.updatePlan(ledgerId, planId, (auth as SessionAuthContext).userId, body);
  }

  @Delete(":planId")
  @ApiNoContentResponse()
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ): Promise<void> {
    await this.plans.archivePlan(ledgerId, planId, (auth as SessionAuthContext).userId);
  }

  @Post(":planId/stop")
  @ApiOkResponse()
  stop(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ) {
    return this.plans.stopPlan(ledgerId, planId, (auth as SessionAuthContext).userId);
  }

  @Post(":planId/restore")
  @ApiOkResponse()
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ) {
    return this.plans.restorePlan(ledgerId, planId, (auth as SessionAuthContext).userId);
  }

  @Get(":planId/progress")
  @ApiOkResponse()
  progress(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
    @Query() query: PlanProgressQueryDto,
  ) {
    return this.plans.getPlanProgress(ledgerId, planId, (auth as SessionAuthContext).userId, query);
  }

  @Get(":planId/share-token")
  @ApiOkResponse({ description: "该计划当前有效的分享 token 元数据（不含明文），无则为 null" })
  getShareToken(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ) {
    return this.shareTokens.getActive(ledgerId, planId, (auth as SessionAuthContext).userId);
  }

  @Post(":planId/share-token")
  @ApiCreatedResponse({ description: "生成分享 token，明文仅返回一次；旧 token 自动吊销" })
  createShareToken(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ) {
    return this.shareTokens.create(ledgerId, planId, (auth as SessionAuthContext).userId);
  }

  @Delete(":planId/share-token")
  @ApiNoContentResponse()
  async revokeShareToken(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("planId") planId: string,
  ): Promise<void> {
    await this.shareTokens.revoke(ledgerId, planId, (auth as SessionAuthContext).userId);
  }
}
