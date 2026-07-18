import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import { AppError } from "@fin-nest/backend";
import type { Response } from "express";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AiService } from "./ai.service";
import { ChatRequestDto } from "./dto/chat-request.dto";
import { ListConversationsQueryDto } from "./dto/list-conversations-query.dto";
import { UpdateCardStateDto } from "./dto/update-card-state.dto";

@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/ai")
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("status")
  @ApiOkResponse()
  status(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.ai.status(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Get("conversations")
  @ApiOkResponse()
  listConversations(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.ai.listConversations(ledgerId, (auth as SessionAuthContext).userId, query);
  }

  @Get("conversations/:conversationId")
  @ApiOkResponse()
  getConversation(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("conversationId") conversationId: string,
  ) {
    return this.ai.getConversation(ledgerId, conversationId, (auth as SessionAuthContext).userId);
  }

  @Delete("conversations/:conversationId")
  @ApiOkResponse()
  async deleteConversation(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("conversationId") conversationId: string,
  ) {
    await this.ai.deleteConversation(ledgerId, conversationId, (auth as SessionAuthContext).userId);
    return { ok: true };
  }

  @Post("chat")
  @ApiOkResponse()
  chat(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ChatRequestDto,
  ) {
    return this.ai.chat(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  /**
   * 流式聊天（SSE over POST）：事件 delta{text} / card{card} / done{chat 同构结果} / error{message}。
   * 头已发出后异常无法走全局过滤器，统一以 error 事件收尾。
   */
  @Post("chat/stream")
  @ApiProduces("text/event-stream")
  @ApiOkResponse()
  async chatStream(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ChatRequestDto,
    @Res() response: Response,
  ) {
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    // 关闭 Nginx 等反代的缓冲，保证增量实时到达浏览器。
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders();

    // 客户端断开（点停止/关页面）即中止上游 LLM 调用，已生成部分由 service 照常持久化。
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    const emit = (event: string, data: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // 周期心跳（SSE 注释帧）：思维链模型首 token 前可能长时间静默，防中间代理按空闲掐断连接。
    const heartbeat = setInterval(() => {
      if (response.destroyed || response.writableEnded) return;
      response.write(`: ping\n\n`);
    }, 15_000);
    try {
      const result = await this.ai.chatStream(
        ledgerId,
        (auth as SessionAuthContext).userId,
        body,
        {
          delta: (text) => emit("delta", { text }),
          card: (card) => emit("card", { card }),
        },
        abort.signal,
      );
      emit("done", result);
    } catch (error) {
      emit("error", {
        message: error instanceof AppError ? error.message : "AI 服务出错，请稍后重试",
      });
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  }

  @Post("messages/:messageId/card-state")
  @ApiOkResponse()
  updateCardState(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("messageId") messageId: string,
    @Body() body: UpdateCardStateDto,
  ) {
    return this.ai.updateCardState(ledgerId, messageId, (auth as SessionAuthContext).userId, body);
  }
}
