import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { TransactionAccountRelationDto } from "../../transactions/dto/create-transaction.dto";

export class CreateAutoRuleDto {
  @ApiProperty({ enum: ["expense", "income", "transfer"] })
  @IsIn(["expense", "income", "transfer"])
  type!: string;

  @ApiProperty({ example: "8800000" })
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

  @ApiPropertyOptional({ type: [TransactionAccountRelationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TransactionAccountRelationDto)
  relations?: TransactionAccountRelationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionId?: string | null;

  @ApiProperty({ enum: ["daily", "weekly", "monthly", "yearly", "once"] })
  @IsIn(["daily", "weekly", "monthly", "yearly", "once"])
  repeatRule!: string;

  @ApiProperty({ example: "2026-06-28" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    example: "09:00",
    description: "指定时间：当天几点生成待确认（本地 HH:mm，24 小时制）。传 null 表示不指定，到期即生成。",
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  runTime?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      "生成待确认后的推送接收人（用户 id，须为本账本成员）。传空数组清除；未指定时间时后端一并清空。",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyUserIds?: string[];
}

export class UpdateAutoRuleDto {
  @ApiPropertyOptional({ enum: ["expense", "income", "transfer"] })
  @IsOptional()
  @IsIn(["expense", "income", "transfer"])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: "8800000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

  @ApiPropertyOptional({ type: [TransactionAccountRelationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TransactionAccountRelationDto)
  relations?: TransactionAccountRelationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionId?: string | null;

  @ApiPropertyOptional({ enum: ["daily", "weekly", "monthly", "yearly", "once"] })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly", "yearly", "once"])
  repeatRule?: string;

  @ApiPropertyOptional({ example: "2026-06-28" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({
    example: "09:00",
    description: "指定时间：当天几点生成待确认（本地 HH:mm，24 小时制）。传 null 表示不指定，到期即生成。",
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  runTime?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      "生成待确认后的推送接收人（用户 id，须为本账本成员）。传空数组清除；未指定时间时后端一并清空。",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyUserIds?: string[];
}
