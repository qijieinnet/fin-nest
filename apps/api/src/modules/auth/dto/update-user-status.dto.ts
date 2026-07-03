import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateUserStatusDto {
  @ApiProperty({ description: "true 表示禁用该用户，false 表示启用" })
  @IsBoolean()
  disabled!: boolean;
}
