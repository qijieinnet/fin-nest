import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsIn, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

export class CreateAccountDto {
  @ApiProperty({ enum: ["savings", "credit", "invest", "receivable", "payable"] })
  @IsIn(["savings", "credit", "invest", "receivable", "payable"])
  type!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @ApiPropertyOptional({ example: "0" })
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/)
  balanceMicros?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeInNetWorth?: boolean;

  @ApiPropertyOptional({ example: "300000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  creditLimitMicros?: string;

  @ApiPropertyOptional({ example: "100000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  investmentCostMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  counterparty?: string;

  @ApiPropertyOptional({ example: "2026-07-27" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billDay?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  repayDay?: number;
}
