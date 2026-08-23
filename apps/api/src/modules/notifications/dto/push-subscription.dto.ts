import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

/**
 * 浏览器 `PushSubscription.toJSON()` 的三件套。
 *
 * 服务端不校验密钥格式：它们由浏览器生成，格式错了在加密阶段自然会失败，
 * 而在这里做半吊子的 base64url 校验只会把将来换算法的实现挡在门外。
 */
export class SavePushSubscriptionDto {
  @ApiProperty({ description: "推送服务投递地址（subscription.endpoint）。" })
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ description: "客户端 P-256 公钥（base64url），来自 subscription.keys.p256dh。" })
  @IsString()
  @MaxLength(255)
  p256dh!: string;

  @ApiProperty({ description: "auth secret（base64url），来自 subscription.keys.auth。" })
  @IsString()
  @MaxLength(255)
  auth!: string;

  @ApiPropertyOptional({ description: "设备展示名。不传时由服务端按 User-Agent 推断。" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceLabel?: string;
}

/** 退订本设备：按 endpoint 定位，因为前端手里只有它（订阅行的 id 是服务端的）。 */
export class DetachPushSubscriptionDto {
  @ApiProperty({ description: "要移除的 subscription.endpoint。" })
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}
