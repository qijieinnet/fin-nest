import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";

/** 两个字段都可选、可单独提交：设置页里是两个独立开关，改一个不该覆盖另一个。 */
export class UpdateAppLockDto {
  @ApiPropertyOptional({ description: "是否要求打开应用时验证身份（账号级，影响该用户所有设备）" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "飞书客户端内是否跳过验证（默认 true）" })
  @IsOptional()
  @IsBoolean()
  skipInFeishu?: boolean;
}
