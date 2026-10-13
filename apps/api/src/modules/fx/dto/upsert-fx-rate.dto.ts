import { ApiProperty } from "@nestjs/swagger";
import { CURRENCY_CODES, FX_RATE_PATTERN } from "@fin-nest/shared";
import { IsIn, IsString, Matches } from "class-validator";

/** 手填汇率：1 currency = rate 账本本币。 */
export class UpsertFxRateDto {
  @ApiProperty({ example: "USD" })
  @IsIn(CURRENCY_CODES)
  currency!: string;

  @ApiProperty({ example: "2026-10-12" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ example: "7.1234", description: "1 单位外币折合多少本币，最多 10 位小数" })
  @IsString()
  @Matches(FX_RATE_PATTERN)
  rate!: string;
}
