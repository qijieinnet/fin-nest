import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateAppLockDto {
  @ApiProperty({ description: "是否要求打开应用时验证身份（账号级，影响该用户所有设备）" })
  @IsBoolean()
  enabled!: boolean;
}
