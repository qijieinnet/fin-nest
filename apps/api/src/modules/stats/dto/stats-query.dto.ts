import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches } from "class-validator";

export class StatsQueryDto {
  @ApiPropertyOptional({ example: "2026-07", description: "统计月份，默认当月" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
