import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsString, Min } from "class-validator";

/** 记账草稿卡确认后回写状态：历史回放时显示「已记账」并防止重复确认。 */
export class UpdateCardStateDto {
  @ApiProperty({ description: "消息 cards 数组中的下标" })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cardIndex!: number;

  @ApiProperty({ enum: ["confirmed"] })
  @IsIn(["confirmed"])
  status!: "confirmed";

  @ApiProperty({ description: "确认后生成的交易 id" })
  @IsString()
  transactionId!: string;
}
