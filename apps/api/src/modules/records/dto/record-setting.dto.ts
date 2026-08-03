import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * 记账提醒。周期决定哪几个字段有意义：
 * daily 只看 remindTime；weekly 看 weekdays（ISO 1=周一…7=周日）；monthly 看 monthDays（1..31）。
 * 未选中的那组仍会原样存下来，方便用户切回去时不用重填。
 */
export class EntryReminderDto {
  @ApiPropertyOptional({ description: "是否开启。关闭后配置保留，只是不再推送。" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "提醒周期：daily/weekly/monthly。" })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  frequency?: "daily" | "weekly" | "monthly";

  @ApiPropertyOptional({ type: [Number], description: "每周提醒的星期，1=周一 … 7=周日。" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: "每月提醒的日号 1..31。当月没有该日时在当月最后一天提醒。",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  monthDays?: number[];

  @ApiPropertyOptional({ example: "20:00", description: "提醒时间：本地 HH:mm（24 小时制）。" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  remindTime?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "推送到的飞书绑定 id 列表（须为本账本成员的生效绑定）。",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  feishuBindingIds?: string[];
}

export class UpdateRecordSettingDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  fieldOrder?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  visibleFields?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acctRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  personRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  continuousEntry?: boolean;

  @ApiPropertyOptional({
    description: "移动端记账表单进入时是否自动展开金额键盘（仅移动壳生效）。",
  })
  @IsOptional()
  @IsBoolean()
  keypadAutoOpen?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  amountDecimalPlaces?: number;

  @ApiPropertyOptional({ type: EntryReminderDto, description: "记账提醒。不传表示不改动。" })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntryReminderDto)
  entryReminder?: EntryReminderDto;
}
