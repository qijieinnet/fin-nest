import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Matches } from "class-validator";

export class UpdateBudgetSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: "500000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  totalAmountMicros?: string;
}

export class UpsertCategoryBudgetDto {
  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty({ example: "100000000" })
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros!: string;
}
