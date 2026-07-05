import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateSubAccountDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @ApiPropertyOptional({ example: "0" })
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/)
  balanceMicros?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeInNetWorth?: boolean;
}
