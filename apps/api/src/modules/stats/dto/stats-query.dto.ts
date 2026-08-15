import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsArray, IsOptional, IsString, Matches } from "class-validator";
import { toIdList } from "../../transactions/transaction-filters";

export class StatsQueryDto {
  @ApiPropertyOptional({ example: "2026-07", description: "统计月份，默认当月（未传日期范围时生效）" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;

  @ApiPropertyOptional({ example: "2026-07-01", description: "分类拆分的开始日期（含），与账单筛选一致" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: "2026-07-31", description: "分类拆分的结束日期（含），与账单筛选一致" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ description: "按分类筛选" })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: "按二级分类筛选" })
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

  @ApiPropertyOptional({ description: "按账户筛选（出入账任一侧命中）" })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: "按子账户筛选" })
  @IsOptional()
  @IsString()
  subAccountId?: string;

  @ApiPropertyOptional({ description: "按人员筛选" })
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional({ example: "1000000", description: "金额下限（micros）" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMinMicros?: string;

  @ApiPropertyOptional({ example: "5000000", description: "金额上限（micros）" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMaxMicros?: string;

  @ApiPropertyOptional({ description: "备注关键词" })
  @IsOptional()
  @IsString()
  note?: string;
}
