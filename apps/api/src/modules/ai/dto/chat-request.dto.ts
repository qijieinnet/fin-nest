import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 聊天请求。流式端点同时接受 JSON 与 multipart（字段 images[] 附账单图片），
 * 带图时 content 可以为空——「只发一张截图」就是最常见的用法；空文字且无图由 service 拒绝。
 */
export class ChatRequestDto {
  @ApiPropertyOptional({ description: "续聊的会话 id；不传则创建新会话" })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: "用户消息内容；附图时可为空" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;
}
