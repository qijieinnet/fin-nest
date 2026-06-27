import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AccountsService } from "./accounts.service";
import { AdjustAccountDto } from "./dto/adjust-account.dto";
import { CreateAccountDto } from "./dto/create-account.dto";
import { CreateSubAccountDto } from "./dto/create-sub-account.dto";
import { SettleAccountDto } from "./dto/settle-account.dto";
import { UpdateAccountDto } from "./dto/update-account.dto";
import { UpdateSubAccountDto } from "./dto/update-sub-account.dto";

@ApiTags("accounts")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.accounts.list(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateAccountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.accounts.create(ledgerId, (auth as SessionAuthContext).userId, body, idempotencyKey);
  }

  @Patch(":accountId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Body() body: UpdateAccountDto,
  ) {
    return this.accounts.update(ledgerId, accountId, (auth as SessionAuthContext).userId, body);
  }

  @Get(":accountId/entries")
  @ApiOkResponse()
  listEntries(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
  ) {
    return this.accounts.listEntries(ledgerId, accountId, (auth as SessionAuthContext).userId);
  }

  @Get(":accountId/sub-accounts")
  @ApiOkResponse()
  listSubAccounts(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
  ) {
    return this.accounts.listSubAccounts(ledgerId, accountId, (auth as SessionAuthContext).userId);
  }

  @Post(":accountId/sub-accounts")
  @ApiCreatedResponse()
  createSubAccount(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Body() body: CreateSubAccountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.accounts.createSubAccount(
      ledgerId,
      accountId,
      (auth as SessionAuthContext).userId,
      body,
      idempotencyKey,
    );
  }

  @Patch(":accountId/sub-accounts/:subAccountId")
  @ApiOkResponse()
  updateSubAccount(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Param("subAccountId") subAccountId: string,
    @Body() body: UpdateSubAccountDto,
  ) {
    return this.accounts.updateSubAccount(
      ledgerId,
      accountId,
      subAccountId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Delete(":accountId/sub-accounts/:subAccountId")
  @ApiNoContentResponse()
  async archiveSubAccount(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Param("subAccountId") subAccountId: string,
  ): Promise<void> {
    await this.accounts.archiveSubAccount(
      ledgerId,
      accountId,
      subAccountId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Delete(":accountId")
  @ApiNoContentResponse()
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
  ): Promise<void> {
    await this.accounts.archive(ledgerId, accountId, (auth as SessionAuthContext).userId);
  }

  @Post(":accountId/settlements")
  @ApiCreatedResponse()
  settle(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Body() body: SettleAccountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.accounts.settle(ledgerId, accountId, (auth as SessionAuthContext).userId, body, idempotencyKey);
  }

  @Post(":accountId/adjustments")
  @ApiCreatedResponse()
  adjust(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("accountId") accountId: string,
    @Body() body: AdjustAccountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.accounts.adjust(ledgerId, accountId, (auth as SessionAuthContext).userId, body, idempotencyKey);
  }
}
