import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class CreateJoinRequestDto {
  @ApiProperty()
  @IsString()
  @Length(16, 120)
  inviteCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  message?: string;
}
