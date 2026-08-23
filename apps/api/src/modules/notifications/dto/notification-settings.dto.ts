import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";

/** 渠道开关。两个都不传是合法的（等于读一次当前设置）。 */
export class UpdateNotificationSettingsDto {
  @ApiPropertyOptional({ description: "是否接收飞书推送。" })
  @IsOptional()
  @IsBoolean()
  notifyFeishu?: boolean;

  @ApiPropertyOptional({ description: "是否接收 Web Push（浏览器/PWA）推送。" })
  @IsOptional()
  @IsBoolean()
  notifyWebPush?: boolean;
}
