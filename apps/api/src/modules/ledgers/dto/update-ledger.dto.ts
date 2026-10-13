import { ApiPropertyOptional } from "@nestjs/swagger";
import { CURRENCY_CODES } from "@fin-nest/shared";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class UpdateLedgerDto {
  @ApiPropertyOptional({ example: "家庭账本" })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ example: "🏠" })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @ApiPropertyOptional({ example: "CNY" })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6, description: "金额展示小数位数" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  amountDecimalPlaces?: number;
}
