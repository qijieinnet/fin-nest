import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class RestoreJsonDto {
  /** 服务端二次确认：必须与当前账本名称完全一致，防止误操作清空账本。 */
  @ApiProperty({ description: "输入当前账本名称以确认覆盖恢复" })
  @IsString()
  @Length(1, 120)
  confirmLedgerName!: string;
}
