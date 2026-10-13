import { CURRENCY_CODES } from "@fin-nest/shared";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class UpdateAutoPendingDto {
  @ApiPropertyOptional({ example: "8800000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros?: string;

  @ApiPropertyOptional({
    example: "USD",
    description:
      "外币金额的币种（不能是本币）；amountMicros 仍是本币金额（估算），生成/记账时按当日汇率重算",
  })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  originalCurrency?: string | null;

  @ApiPropertyOptional({ example: "20000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  originalAmountMicros?: string | null;

  @ApiPropertyOptional({ example: "2026-06-28" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledFor?: string;

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
}

export class ListAutoPendingQueryDto {
  @ApiPropertyOptional({ example: "pending" })
  @IsOptional()
  @IsString()
  status?: string;
}
