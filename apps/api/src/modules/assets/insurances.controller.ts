import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
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
import { AssetsService } from "./assets.service";
import {
  CreateInsuranceDto,
  ReorderInsurancesDto,
  ReorderInsuranceTypesDto,
  UpdateInsuranceDto,
} from "./dto/insurance.dto";
import { LinkTransactionDto } from "./dto/link-transaction.dto";

@ApiTags("insurances")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/insurances")
export class InsurancesController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.assets.listInsurances(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get(":insuranceId")
  @ApiOkResponse()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
  ) {
    return this.assets.getInsurance(ledgerId, insuranceId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateInsuranceDto,
  ) {
    return this.assets.createInsurance(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch("reorder")
  @ApiNoContentResponse()
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ReorderInsurancesDto,
  ): Promise<void> {
    await this.assets.reorderInsurances(ledgerId, (auth as SessionAuthContext).userId, body.ids);
  }

  @Patch("reorder-types")
  @ApiNoContentResponse()
  async reorderTypes(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ReorderInsuranceTypesDto,
  ): Promise<void> {
    await this.assets.reorderInsuranceTypes(
      ledgerId,
      (auth as SessionAuthContext).userId,
      body.types,
    );
  }

  @Patch(":insuranceId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
    @Body() body: UpdateInsuranceDto,
  ) {
    return this.assets.updateInsurance(
      ledgerId,
      insuranceId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Post(":insuranceId/terminate")
  @ApiOkResponse()
  terminate(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
  ) {
    return this.assets.terminateInsurance(
      ledgerId,
      insuranceId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Post(":insuranceId/resume")
  @ApiOkResponse()
  resume(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
  ) {
    return this.assets.resumeInsurance(ledgerId, insuranceId, (auth as SessionAuthContext).userId);
  }

  @Post(":insuranceId/transactions")
  @ApiCreatedResponse()
  linkTransaction(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
    @Body() body: LinkTransactionDto,
  ) {
    return this.assets.linkTransaction(
      ledgerId,
      "insurance",
      insuranceId,
      body.transactionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Delete(":insuranceId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("insuranceId") insuranceId: string,
  ): Promise<void> {
    await this.assets.deleteInsurance(ledgerId, insuranceId, (auth as SessionAuthContext).userId);
  }
}
