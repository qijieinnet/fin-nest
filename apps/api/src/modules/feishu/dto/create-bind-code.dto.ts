import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateBindCodeDto {
  @ApiProperty({ description: "绑定后飞书侧的默认账本；绑定后可在飞书里切换" })
  @IsUUID()
  ledgerId!: string;
}
