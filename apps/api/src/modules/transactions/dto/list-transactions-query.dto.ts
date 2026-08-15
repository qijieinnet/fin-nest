import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { toIdList } from "../transaction-filters";

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ enum: ["expense", "income", "transfer"] })
  @IsOptional()
  @IsIn(["expense", "income", "transfer"])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "按一级分类多选筛选，与 subcategoryIds 取并集",
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "按二级分类多选筛选，与 categoryIds 取并集",
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  subcategoryIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "按账户多选筛选（含其全部子账户），与 subAccountIds 取并集",
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  accountIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "按子账户多选筛选，与 accountIds 取并集",
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  subAccountIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional({ type: [String], description: "按人员多选筛选" })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  personIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({ type: [String], description: "按记账人（创建者）多选筛选" })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  createdByIds?: string[];

  @ApiPropertyOptional({ example: "2026-06-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: "2026-06-30" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({
    example: "2026-06-01",
    description: "记录时间（createdAt）起始日，含当日",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  createdFrom?: string;

  @ApiPropertyOptional({
    example: "2026-06-30",
    description: "记录时间（createdAt）截止日，含当日",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  createdTo?: string;

  @ApiPropertyOptional({
    enum: ["occurredOn", "createdAt"],
    description: "排序字段：交易日期或记账时间",
  })
  @IsOptional()
  @IsIn(["occurredOn", "createdAt"])
  sortBy?: "occurredOn" | "createdAt";

  @ApiPropertyOptional({ enum: ["asc", "desc"], description: "排序方向，默认 desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: "asc" | "desc";

  @ApiPropertyOptional({ example: "1000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMinMicros?: string;

  @ApiPropertyOptional({ example: "5000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMaxMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: "单页条数，默认 200，最大 500" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: "跳过条数，配合 limit 翻页" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
