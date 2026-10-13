import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CURRENCY_CODES } from "@fin-nest/shared";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export class FxRateQueryDto {
  @ApiProperty({ example: "USD" })
  @IsIn(CURRENCY_CODES)
  from!: string;

  @ApiPropertyOptional({ example: "CNY", description: "不传为账本本币" })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  to?: string;

  @ApiPropertyOptional({ example: "2026-10-12", description: "不传为今天" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
