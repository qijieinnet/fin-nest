import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export class StatisticsQueryDto {
  @ApiPropertyOptional({ enum: ["expense", "income"] })
  @IsOptional()
  @IsIn(["expense", "income"])
  type?: "expense" | "income";

  @ApiPropertyOptional({ example: "2026-06" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
