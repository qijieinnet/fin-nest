import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, Length } from "class-validator";

export class FeishuSilentLoginDto {
  @ApiProperty({ description: "飞书授权页回跳带回的一次性授权码（5 分钟有效）" })
  @IsString()
  @Length(1, 512)
  code!: string;

  @ApiPropertyOptional({
    description: "发起授权时用的回调地址，换取 token 时必须一模一样地带上",
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(1, 512)
  redirectUri?: string;
}

export class FeishuBindTicketDto {
  @ApiProperty({ description: "免登时下发的待绑定票据，登录后凭此把飞书号绑到当前账号" })
  @IsString()
  @Length(1, 200)
  ticket!: string;
}
