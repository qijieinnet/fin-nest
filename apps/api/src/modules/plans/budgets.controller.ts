import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { UpdateBudgetSettingDto, UpsertCategoryBudgetDto } from "./dto/budget.dto";
import { BudgetProgressQueryDto } from "./dto/progress-query.dto";
import { PlansService } from "./plans.service";

@ApiTags("budgets")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/budgets")
export class BudgetsController {
  constructor(private readonly plans: PlansService) {}

  @Get("setting")
  @ApiOkResponse()
  getSetting(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.plans.getBudgetSetting(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Patch("setting")
  @ApiOkResponse()
  updateSetting(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UpdateBudgetSettingDto,
  ) {
    return this.plans.updateBudgetSetting(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Get("categories")
  @ApiOkResponse()
  listCategories(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.plans.listCategoryBudgets(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post("categories")
  @ApiCreatedResponse()
  upsertCategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UpsertCategoryBudgetDto,
  ) {
    return this.plans.upsertCategoryBudget(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Delete("categories/:categoryBudgetId")
  @ApiNoContentResponse()
  async deleteCategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryBudgetId") categoryBudgetId: string,
  ): Promise<void> {
    await this.plans.deleteCategoryBudget(
      ledgerId,
      categoryBudgetId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Get("progress")
  @ApiOkResponse()
  progress(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: BudgetProgressQueryDto,
  ) {
    return this.plans.getBudgetProgress(ledgerId, (auth as SessionAuthContext).userId, query);
  }
}
