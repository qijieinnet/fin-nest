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
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CreateInviteDto } from "./dto/create-invite.dto";
import { CreateJoinRequestDto } from "./dto/create-join-request.dto";
import { CreateLedgerDto } from "./dto/create-ledger.dto";
import { UpdateLedgerDto } from "./dto/update-ledger.dto";
import { LedgersService } from "./ledgers.service";

@ApiTags("ledgers")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller()
export class LedgersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Get("ledgers")
  @ApiOkResponse({ description: "当前用户可访问的账本" })
  list(@CurrentAuth() auth: AuthContext) {
    return this.ledgers.listForUser((auth as SessionAuthContext).userId);
  }

  @Post("ledgers")
  @ApiCreatedResponse({ description: "创建账本并初始化默认数据" })
  create(@CurrentAuth() auth: AuthContext, @Body() body: CreateLedgerDto) {
    return this.ledgers.create(body, (auth as SessionAuthContext).userId);
  }

  @Get("ledgers/:ledgerId")
  @ApiOkResponse()
  get(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.ledgers.get(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Patch("ledgers/:ledgerId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UpdateLedgerDto,
  ) {
    return this.ledgers.update(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Delete("ledgers/:ledgerId")
  @ApiNoContentResponse()
  async delete(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string): Promise<void> {
    await this.ledgers.delete(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get("ledgers/:ledgerId/members")
  @ApiOkResponse({ description: "成员列表，每项附带成员的 alias/account" })
  members(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.ledgers.listMembers(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Delete("ledgers/:ledgerId/members/:userId")
  @ApiNoContentResponse()
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("userId") userId: string,
  ): Promise<void> {
    await this.ledgers.removeMember(ledgerId, userId, (auth as SessionAuthContext).userId);
  }

  @Post("ledgers/:ledgerId/invites")
  @ApiCreatedResponse({ description: "创建邀请码，明文 code 仅返回一次" })
  createInvite(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateInviteDto,
  ) {
    return this.ledgers.createInvite(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Delete("ledgers/:ledgerId/invites/:inviteId")
  @ApiNoContentResponse()
  async revokeInvite(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("inviteId") inviteId: string,
  ): Promise<void> {
    await this.ledgers.revokeInvite(ledgerId, inviteId, (auth as SessionAuthContext).userId);
  }

  @Get("ledgers/:ledgerId/join-requests")
  @ApiOkResponse({ description: "加入申请列表，每项附带申请人的 requesterAlias/requesterAccount" })
  joinRequests(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query("status") status?: string,
  ) {
    return this.ledgers.listJoinRequests(ledgerId, (auth as SessionAuthContext).userId, status);
  }

  @Post("ledgers/:ledgerId/join-requests/:requestId/approve")
  @ApiOkResponse()
  approveJoinRequest(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId") requestId: string,
  ) {
    return this.ledgers.approveJoinRequest(ledgerId, requestId, (auth as SessionAuthContext).userId);
  }

  @Post("ledgers/:ledgerId/join-requests/:requestId/reject")
  @ApiOkResponse()
  rejectJoinRequest(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId") requestId: string,
  ) {
    return this.ledgers.rejectJoinRequest(ledgerId, requestId, (auth as SessionAuthContext).userId);
  }

  @Post("ledger-join-requests")
  @ApiCreatedResponse({ description: "通过邀请码创建 pending 加入申请" })
  createJoinRequest(@CurrentAuth() auth: AuthContext, @Body() body: CreateJoinRequestDto) {
    return this.ledgers.createJoinRequest((auth as SessionAuthContext).userId, body);
  }

  @Post("ledger-join-requests/:requestId/cancel")
  @ApiOkResponse()
  cancelJoinRequest(@CurrentAuth() auth: AuthContext, @Param("requestId") requestId: string) {
    return this.ledgers.cancelJoinRequest(requestId, (auth as SessionAuthContext).userId);
  }
}
