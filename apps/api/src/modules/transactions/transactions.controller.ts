import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { BatchUpdateTransactionsDto } from "./dto/batch-update-transactions.dto";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { ListTransactionsQueryDto } from "./dto/list-transactions-query.dto";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";
import { TransactionsService } from "./transactions.service";

@ApiTags("transactions")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/transactions")
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactions.list(ledgerId, (auth as SessionAuthContext).userId, query);
  }

  @Get("summary")
  @ApiOkResponse({ description: "按相同筛选聚合支出/收入合计" })
  summary(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactions.summary(ledgerId, (auth as SessionAuthContext).userId, query);
  }

  @Get(":transactionId")
  @ApiOkResponse()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("transactionId") transactionId: string,
  ) {
    return this.transactions.get(ledgerId, transactionId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateTransactionDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.transactions.create(ledgerId, (auth as SessionAuthContext).userId, body, idempotencyKey);
  }

  @Post("batch")
  @HttpCode(200)
  @ApiOkResponse({ description: "批量修改多笔交易的单个字段" })
  batchUpdate(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: BatchUpdateTransactionsDto,
  ) {
    return this.transactions.batchUpdate(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch(":transactionId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("transactionId") transactionId: string,
    @Body() body: UpdateTransactionDto,
  ) {
    return this.transactions.update(ledgerId, transactionId, (auth as SessionAuthContext).userId, body);
  }

  @Delete(":transactionId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("transactionId") transactionId: string,
  ): Promise<void> {
    await this.transactions.delete(ledgerId, transactionId, (auth as SessionAuthContext).userId);
  }
}
