import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";

export class ListAgentRequestsQueryDto {
  @ApiPropertyOptional({
    enum: ["pending", "approved", "rejected", "withdrawn", "failed", "all"],
    default: "pending",
  })
  @IsOptional()
  @IsIn(["pending", "approved", "rejected", "withdrawn", "failed", "all"])
  status?: string;
}
