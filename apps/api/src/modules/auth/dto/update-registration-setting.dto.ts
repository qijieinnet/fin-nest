import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateRegistrationSettingDto {
  @ApiProperty()
  @IsBoolean()
  registrationEnabled!: boolean;
}
