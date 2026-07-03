import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateUserAdminDto {
  @ApiProperty({ description: "true 表示设为管理员，false 表示取消管理员" })
  @IsBoolean()
  isAdmin!: boolean;
}
