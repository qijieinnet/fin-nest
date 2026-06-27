import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Min } from "class-validator";

export class CreatePlanDto {
  @ApiProperty({ enum: ["expense", "income"] })
  @IsIn(["expense", "income"])
  kind!: string;

  @ApiProperty({ enum: ["amount", "count"] })
  @IsIn(["amount", "count"])
  metric!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ example: "200000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  limitAmountMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limitCount?: number;

  @ApiProperty({ example: "2026-06-01" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @ApiProperty({ enum: ["weekly", "monthly", "yearly", "once"] })
  @IsIn(["weekly", "monthly", "yearly", "once"])
  repeatRule!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  matchRule?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  foresightEnabled?: boolean;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ enum: ["expense", "income"] })
  @IsOptional()
  @IsIn(["expense", "income"])
  kind?: string;

  @ApiPropertyOptional({ enum: ["amount", "count"] })
  @IsOptional()
  @IsIn(["amount", "count"])
  metric?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ example: "200000000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  limitAmountMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limitCount?: number;

  @ApiPropertyOptional({ example: "2026-06-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ enum: ["weekly", "monthly", "yearly", "once"] })
  @IsOptional()
  @IsIn(["weekly", "monthly", "yearly", "once"])
  repeatRule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  matchRule?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  foresightEnabled?: boolean;
}
