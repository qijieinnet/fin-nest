import { ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateRecordSettingDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  fieldOrder?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  visibleFields?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acctRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  personRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  continuousEntry?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  amountDecimalPlaces?: number;
}
