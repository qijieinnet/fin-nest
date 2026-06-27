import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateSubAccountDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ example: "0" })
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/)
  balanceMicros?: string;
}
