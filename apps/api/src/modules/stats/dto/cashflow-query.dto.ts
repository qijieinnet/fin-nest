import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import type { NetWorthRange } from "../../accounts/net-worth";
import { StatsQueryDto } from "./stats-query.dto";

export class CashflowQueryDto extends StatsQueryDto {
  @ApiPropertyOptional({
    enum: ["week", "month1", "month6", "year"],
    description: "收支走势范围：近1周/近1个月/近6个月/近1年，默认近6个月",
  })
  @IsOptional()
  @IsIn(["week", "month1", "month6", "year"])
  range?: NetWorthRange;
}
