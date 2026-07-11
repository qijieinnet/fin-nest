import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from "class-validator";
import { IsArray } from "class-validator";

export class CreateSubscriptionCategoryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 16)
  icon?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSubscriptionCategoryDto extends PartialType(CreateSubscriptionCategoryDto) {}

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  priceMicros?: string;

  @ApiPropertyOptional({ description: "计费周期：weekly/monthly/quarterly/yearly/custom 等" })
  @IsOptional()
  @IsString()
  billingCycle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({ example: "2026-01-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ example: "2026-02-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  nextRenewalDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {}

export class ReorderSubscriptionsDto {
  @ApiProperty({ type: [String], description: "同一分类内的订阅 id 按目标顺序排列" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderSubscriptionCategoriesDto {
  @ApiProperty({ type: [String], description: "订阅分类 id 按目标顺序排列" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}
