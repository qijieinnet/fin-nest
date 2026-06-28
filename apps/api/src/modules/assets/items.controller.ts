import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AssetsService } from "./assets.service";
import { CreateItemDto, CreateItemTypeDto, ScrapItemDto, UpdateItemDto } from "./dto/item.dto";
import { LinkTransactionDto } from "./dto/link-transaction.dto";

@ApiTags("items")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class ItemsController {
  constructor(private readonly assets: AssetsService) {}

  @Get("item-types")
  @ApiOkResponse()
  listTypes(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.assets.listItemTypes(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post("item-types")
  @ApiCreatedResponse()
  createType(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreateItemTypeDto) {
    return this.assets.createItemType(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Get("items")
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.assets.listItems(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get("items/:itemId")
  @ApiOkResponse()
  get(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("itemId") itemId: string) {
    return this.assets.getItem(ledgerId, itemId, (auth as SessionAuthContext).userId);
  }

  @Post("items")
  @ApiCreatedResponse()
  create(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreateItemDto) {
    return this.assets.createItem(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch("items/:itemId")
  @ApiOkResponse()
  update(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("itemId") itemId: string, @Body() body: UpdateItemDto) {
    return this.assets.updateItem(ledgerId, itemId, (auth as SessionAuthContext).userId, body);
  }

  @Post("items/:itemId/scrap")
  @ApiOkResponse()
  scrap(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("itemId") itemId: string, @Body() body: ScrapItemDto) {
    return this.assets.scrapItem(ledgerId, itemId, (auth as SessionAuthContext).userId, body);
  }

  @Post("items/:itemId/restore")
  @ApiOkResponse()
  restore(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("itemId") itemId: string) {
    return this.assets.restoreItem(ledgerId, itemId, (auth as SessionAuthContext).userId);
  }

  @Post("items/:itemId/transactions")
  @ApiCreatedResponse()
  linkTransaction(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("itemId") itemId: string,
    @Body() body: LinkTransactionDto,
  ) {
    return this.assets.linkTransaction(ledgerId, "item", itemId, body.transactionId, (auth as SessionAuthContext).userId);
  }

  @Delete("items/:itemId")
  @ApiNoContentResponse()
  async delete(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("itemId") itemId: string): Promise<void> {
    await this.assets.deleteItem(ledgerId, itemId, (auth as SessionAuthContext).userId);
  }
}
