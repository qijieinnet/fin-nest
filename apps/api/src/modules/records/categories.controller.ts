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
import {
  CreateCategoryDto,
  CreateSubcategoryDto,
  ReorderCategoriesDto,
  ReorderSubcategoriesDto,
  UpdateCategoryDto,
  UpdateSubcategoryDto,
} from "./dto/category.dto";
import { RecordsService } from "./records.service";

@ApiTags("categories")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/categories")
export class CategoriesController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query("type") type?: string,
  ) {
    return this.records.listCategories(ledgerId, (auth as SessionAuthContext).userId, type);
  }

  @Post()
  @ApiCreatedResponse()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: CreateCategoryDto,
  ) {
    return this.records.createCategory(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch("reorder")
  @ApiOkResponse()
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ReorderCategoriesDto,
  ): Promise<void> {
    await this.records.reorderCategories(
      ledgerId,
      (auth as SessionAuthContext).userId,
      body.type,
      body.ids,
    );
  }

  @Patch(":categoryId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Body() body: UpdateCategoryDto,
  ) {
    return this.records.updateCategory(
      ledgerId,
      categoryId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Delete(":categoryId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
  ): Promise<void> {
    await this.records.deleteCategory(ledgerId, categoryId, (auth as SessionAuthContext).userId);
  }

  @Post(":categoryId/subcategories")
  @ApiCreatedResponse()
  createSubcategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Body() body: CreateSubcategoryDto,
  ) {
    return this.records.createSubcategory(
      ledgerId,
      categoryId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Patch(":categoryId/subcategories/reorder")
  @ApiOkResponse()
  async reorderSubcategories(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Body() body: ReorderSubcategoriesDto,
  ): Promise<void> {
    await this.records.reorderSubcategories(
      ledgerId,
      categoryId,
      (auth as SessionAuthContext).userId,
      body.ids,
    );
  }

  @Patch(":categoryId/subcategories/:subcategoryId")
  @ApiOkResponse()
  updateSubcategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Param("subcategoryId") subcategoryId: string,
    @Body() body: UpdateSubcategoryDto,
  ) {
    return this.records.updateSubcategory(
      ledgerId,
      categoryId,
      subcategoryId,
      (auth as SessionAuthContext).userId,
      body,
    );
  }

  @Delete(":categoryId/subcategories/:subcategoryId")
  @ApiNoContentResponse()
  async deleteSubcategory(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("categoryId") categoryId: string,
    @Param("subcategoryId") subcategoryId: string,
  ): Promise<void> {
    await this.records.deleteSubcategory(
      ledgerId,
      categoryId,
      subcategoryId,
      (auth as SessionAuthContext).userId,
    );
  }
}
