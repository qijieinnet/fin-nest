import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsString, Min, ValidateIf } from "class-validator";

/**
 * 记账草稿卡回写状态：
 * - confirmed：确认入账后回写「已记账」，需带交易 id，防止重复确认；
 * - superseded：用户手动作废该草稿，不入账，无需交易 id。
 */
export class UpdateCardStateDto {
  @ApiProperty({ description: "消息 cards 数组中的下标" })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cardIndex!: number;

  @ApiProperty({ enum: ["confirmed", "superseded"] })
  @IsIn(["confirmed", "superseded"])
  status!: "confirmed" | "superseded";

  @ApiProperty({ description: "确认后生成的交易 id（status=confirmed 时必填）" })
  @ValidateIf((dto: UpdateCardStateDto) => dto.status === "confirmed")
  @IsString()
  transactionId?: string;
}
