import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AutomationService } from "./automation.service";
import { ListAutoPendingQueryDto, UpdateAutoPendingDto } from "./dto/auto-pending.dto";
import { ConfirmAutoPendingBatchDto } from "./dto/confirm-batch.dto";

@ApiTags("auto-pending")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/auto-pending-transactions")
export class AutoPendingController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ListAutoPendingQueryDto,
  ) {
    return this.automation.listPending(ledgerId, (auth as SessionAuthContext).userId, query);
  }

  @Patch(":pendingId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("pendingId") pendingId: string,
    @Body() body: UpdateAutoPendingDto,
  ) {
    return this.automation.updatePending(ledgerId, pendingId, (auth as SessionAuthContext).userId, body);
  }

  @Post(":pendingId/confirm")
  @ApiOkResponse()
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("pendingId") pendingId: string,
  ) {
    return this.automation.confirmPending(ledgerId, pendingId, (auth as SessionAuthContext).userId);
  }

  @Post("confirm-batch")
  @ApiOkResponse()
  confirmBatch(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ConfirmAutoPendingBatchDto,
  ) {
    return this.automation.confirmPendingBatch(ledgerId, body.pendingIds, (auth as SessionAuthContext).userId);
  }

  @Delete(":pendingId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("pendingId") pendingId: string,
  ): Promise<void> {
    await this.automation.deletePending(ledgerId, pendingId, (auth as SessionAuthContext).userId);
  }
}
