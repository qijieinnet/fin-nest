import { ApiPropertyOptional } from "@nestjs/swagger";
import { SUPPORTED_LOCALES, type AppLocale } from "@fin-nest/shared";
import { IsIn, IsOptional, ValidateIf } from "class-validator";

/** 账号级界面偏好。字段不传 = 保持不变。 */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description: "界面语言；传 null 清除设置，回到跟随设备语言",
    enum: SUPPORTED_LOCALES,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(SUPPORTED_LOCALES)
  locale?: AppLocale | null;
}
