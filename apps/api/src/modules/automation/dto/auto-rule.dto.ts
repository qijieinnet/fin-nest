import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateAutoRuleDto {
  @ApiProperty({ enum: ["expense", "income"] })
  @IsIn(["expense", "income"])
  type!: string;

  @ApiProperty({ example: "8800000" })
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros!: string;

  @ApiProperty()
  @IsString()
  categoryId!: string;

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
  personId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

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
}

export class UpdateAutoRuleDto {
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
  categoryId?: string;

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
  personId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

  @ApiPropertyOptional({ enum: ["daily", "weekly", "monthly", "yearly", "once"] })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly", "yearly", "once"])
  repeatRule?: string;

  @ApiPropertyOptional({ example: "2026-06-28" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;
}
