import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Min } from "class-validator";

/**
 * 到期提醒的一档。订阅与保单共用。
 *
 * 三个字段都是必填：多档模型里「只配提前量不配时刻」没有意义——同一天多档要靠时刻区分先后。
 * 接收人逐档独立，因此 feishuBindingIds 也挂在这里而不是挂在订阅/保单上。
 */
export class ReminderScheduleDto {
  @ApiProperty({ description: "提前量，配合 leadUnit。", example: 7 })
  @IsInt()
  @Min(1)
  leadValue!: number;

  @ApiProperty({ description: "提前量单位：day/week/month/year。" })
  @IsIn(["day", "week", "month", "year"])
  leadUnit!: "day" | "week" | "month" | "year";

  @ApiProperty({ description: "提醒时间：本地 HH:mm（24 小时制），到点后由 worker 推送。" })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  remindTime!: string;

  @ApiPropertyOptional({
    type: [String],
    description: "这一档推送到的飞书绑定 id 列表（须为本账本成员的生效绑定）。",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  feishuBindingIds?: string[];
}
