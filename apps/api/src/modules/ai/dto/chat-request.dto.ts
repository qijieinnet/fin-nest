import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class ChatRequestDto {
  @ApiPropertyOptional({ description: "续聊的会话 id；不传则创建新会话" })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiProperty({ description: "用户消息内容" })
  @IsString()
  @Length(1, 4000)
  content!: string;
}
