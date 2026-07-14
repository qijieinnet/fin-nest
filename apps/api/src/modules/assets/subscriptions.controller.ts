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
import { LinkTransactionDto } from "./dto/link-transaction.dto";
import {
  CreateSubscriptionCategoryDto,
  CreateSubscriptionDto,
  ReorderSubscriptionCategoriesDto,
  ReorderSubscriptionsDto,
  UpdateSubscriptionCategoryDto,
  UpdateSubscriptionDto,
} from "./dto/subscription.dto";

@ApiTags("subscriptions")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class SubscriptionsController {
  constructor(private readonly assets: AssetsService) {}

  @Get("subscription-categories")
  @ApiOkResponse()
  listCategories(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.assets.listSubscriptionCategories(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post("subscription-categories")
  @ApiCreatedResponse()
  createCategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateSubscriptionCategoryDto,
  ) {
    return this.assets.createSubscriptionCategory(
      ledgerId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Patch("subscription-categories/reorder")
  @ApiNoContentResponse()
  async reorderCategories(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ReorderSubscriptionCategoriesDto,
  ): Promise<void> {
    await this.assets.reorderSubscriptionCategories(
      ledgerId,
      (auth as SessionAuthContext).userId,
      body.ids,
    );
  }

  @Patch("subscription-categories/:categoryId")
  @ApiOkResponse()
  updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Body() body: UpdateSubscriptionCategoryDto,
  ) {
    return this.assets.updateSubscriptionCategory(
      ledgerId,
      categoryId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Delete("subscription-categories/:categoryId")
  @ApiNoContentResponse()
  async archiveCategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
  ): Promise<void> {
    await this.assets.archiveSubscriptionCategory(
      ledgerId,
      categoryId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Get("subscriptions")
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.assets.listSubscriptions(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get("subscriptions/:subscriptionId")
  @ApiOkResponse()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    return this.assets.getSubscription(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Post("subscriptions")
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateSubscriptionDto,
  ) {
    return this.assets.createSubscription(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch("subscriptions/reorder")
  @ApiNoContentResponse()
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ReorderSubscriptionsDto,
  ): Promise<void> {
    await this.assets.reorderSubscriptions(ledgerId, (auth as SessionAuthContext).userId, body.ids);
  }

  @Patch("subscriptions/:subscriptionId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    return this.assets.updateSubscription(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Post("subscriptions/:subscriptionId/terminate")
  @ApiOkResponse()
  terminate(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    return this.assets.terminateSubscription(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Post("subscriptions/:subscriptionId/resume")
  @ApiOkResponse()
  resume(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    return this.assets.resumeSubscription(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Post("subscriptions/:subscriptionId/confirm-renewal")
  @ApiOkResponse()
  confirmRenewal(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    return this.assets.confirmSubscriptionRenewal(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Post("subscriptions/:subscriptionId/transactions")
  @ApiCreatedResponse()
  linkTransaction(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: LinkTransactionDto,
  ) {
    return this.assets.linkTransaction(
      ledgerId,
      "subscription",
      subscriptionId,
      body.transactionId,
      (auth as SessionAuthContext).userId,
    );
  }

  @Delete("subscriptions/:subscriptionId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("subscriptionId") subscriptionId: string,
  ): Promise<void> {
    await this.assets.deleteSubscription(
      ledgerId,
      subscriptionId,
      (auth as SessionAuthContext).userId,
    );
  }
}
