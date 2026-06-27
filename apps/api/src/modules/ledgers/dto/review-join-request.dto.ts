import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class ReviewJoinRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  message?: string;
}
