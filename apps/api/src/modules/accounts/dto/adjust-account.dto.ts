import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";

export class AdjustAccountDto {
  @ApiProperty({ example: "120000000" })
  @IsString()
  @Matches(/^-?\d+$/)
  balanceAfterMicros!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;
}
