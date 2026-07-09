import { ApiProperty } from "@nestjs/swagger";
import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class ReorderAccountsDto {
  @ApiProperty({ type: [String], description: "账户 id 按目标顺序排列（须同属一个分类）" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderSubAccountsDto {
  @ApiProperty({ type: [String], description: "子账户 id 按目标顺序排列" })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}
