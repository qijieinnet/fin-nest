import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(8, 128)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @Length(8, 128)
  newPassword!: string;
}
