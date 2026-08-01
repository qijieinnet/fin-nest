import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class UpdateBackupSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ["daily", "weekly", "monthly"] })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  frequency?: string;

  /** ISO 星期：1=周一 … 7=周日。 */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @Type(() => Number)
  weekdays?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  @Type(() => Number)
  monthDays?: number[];

  /** 本地 HH:mm（24 小时制）。 */
  @ApiPropertyOptional({ example: "03:00" })
  @IsOptional()
  @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { message: "备份时间格式应为 HH:mm" })
  runTime?: string;

  /** 自动备份保留份数，0 表示不限。 */
  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  keepCount?: number;
}

export class RestoreBackupDto {
  /** 当前管理员自己的登录密码，二次确认用。 */
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password!: string;
}
