import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Length, Matches } from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "qijie" })
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/)
  account!: string;

  @ApiProperty({ example: "七戒" })
  @IsString()
  @Length(1, 40)
  alias!: string;

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
