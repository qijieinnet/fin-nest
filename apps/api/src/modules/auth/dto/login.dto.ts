import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class LoginDto {
  @ApiProperty({ description: "邮箱或账号", example: "qijie" })
  @IsString()
  @Length(1, 120)
  login!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @Length(8, 128)
  password!: string;

  @ApiPropertyOptional({ example: "MacBook Pro" })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}
