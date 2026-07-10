import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from "class-validator";

export class CreateInsuranceDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  type!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insurer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  policyNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  coverageMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  premiumMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  premiumFreq?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  periods?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  renewal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverageDesc?: string;

  @ApiPropertyOptional({ example: "2026-01-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  insuredPersonIds?: string[];
}

export class UpdateInsuranceDto extends PartialType(CreateInsuranceDto) {}

export class ReorderInsurancesDto {
  @ApiProperty({ type: [String], description: "同一保险类型内的保单 id 按目标顺序排列" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderInsuranceTypesDto {
  @ApiProperty({ type: [String], description: "保险分类值按目标顺序排列" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  types!: string[];
}
