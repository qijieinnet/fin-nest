import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

export class UpdateLedgerDto {
  @ApiPropertyOptional({ example: "家庭账本" })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ example: "home" })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @ApiPropertyOptional({ example: "CNY" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6, description: "金额展示小数位数" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  amountDecimalPlaces?: number;
}
