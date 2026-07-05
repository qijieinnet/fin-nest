import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CreatePlanDto, UpdatePlanDto } from "./dto/plan.dto";
import { PlanProgressQueryDto } from "./dto/progress-query.dto";
import { PlansService } from "./plans.service";

@ApiTags("plans")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

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
}
