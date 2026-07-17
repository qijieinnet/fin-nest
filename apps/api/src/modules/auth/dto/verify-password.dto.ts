import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class VerifyPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @Length(8, 128)
  password!: string;
}
