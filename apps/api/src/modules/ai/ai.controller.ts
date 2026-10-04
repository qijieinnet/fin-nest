import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import { AppError } from "@fin-nest/backend";
import type { Response } from "express";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { AiChatRuns } from "./ai-chat-runs";
import { AiService } from "./ai.service";
import { ChatRequestDto } from "./dto/chat-request.dto";
import { ListConversationsQueryDto } from "./dto/list-conversations-query.dto";
import { UpdateCardStateDto } from "./dto/update-card-state.dto";
import { UpdateDraftCardsDto } from "./dto/update-draft-cards.dto";

// 聊天附图走 multipart 字段 images（JSON 请求体不受影响，飞书等调用方照旧）。
// 张数/大小的业务上限在 service 里校验并给出中文提示，这里的 multer 限制只是防超大请求的硬闸。
const chatImagesInterceptor = FilesInterceptor("images", 8, {
  limits: { fileSize: 16 * 1024 * 1024 },
});

@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/ai")
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly runs: AiChatRuns,
  ) {}

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
  @UseInterceptors(chatImagesInterceptor)
  @ApiConsumes("application/json", "multipart/form-data")
  @ApiOkResponse()
  chat(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ChatRequestDto,
    @UploadedFiles() images: Express.Multer.File[] | undefined,
  ) {
    return this.ai.chat(ledgerId, (auth as SessionAuthContext).userId, body, images ?? []);
  }

  /**
   * 流式聊天（SSE over POST）：事件 start{conversationId,userMessageId} / delta{text} / card{card} /
   * done{chat 同构结果} / error{message,code}。头已发出后异常无法走全局过滤器，统一以 error 事件收尾；
   * 发头之前的拒绝（重复 requestId → 409）走正常 HTTP 错误响应。
   */
  @Post("chat/stream")
  @UseInterceptors(chatImagesInterceptor)
  @ApiConsumes("application/json", "multipart/form-data")
  @ApiProduces("text/event-stream")
  @ApiOkResponse()
  async chatStream(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: ChatRequestDto,
    @UploadedFiles() images: Express.Multer.File[] | undefined,
    @Res() response: Response,
  ) {
    // 客户端断开不中止：iOS 切到别的 App 会掐断请求，本轮照常跑完落库，前端回来后按 requestId 查轮次状态恢复。
    // 只有显式停止（POST chat/stream/:requestId/cancel）才中止，已生成部分由 service 照常持久化。
    const userId = (auth as SessionAuthContext).userId;
    let run: ReturnType<AiChatRuns["register"]> | null = null;
    if (body.requestId) {
      // 发头前：先校验账本成员（权限先行），再拒绝本账本内的重复提交——客户端拿到真正的
      // HTTP 403/409（409 据此转去恢复原轮次）。跨账本的同 id 由唯一索引兜底。
      await this.ai.assertLedgerMember(ledgerId, userId);
      await this.ai.assertRequestIdUnused(ledgerId, body.requestId);
      run = this.runs.register(ledgerId, userId, body.requestId);
    }

    const emit = (event: string, data: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      // 关闭 Nginx 等反代的缓冲，保证增量实时到达浏览器。
      response.setHeader("x-accel-buffering", "no");
      response.flushHeaders();
      // 周期心跳（SSE 注释帧）：思维链模型首 token 前可能长时间静默，防中间代理按空闲掐断连接。
      heartbeat = setInterval(() => {
        if (response.destroyed || response.writableEnded) return;
        response.write(`: ping\n\n`);
      }, 15_000);
      const result = await this.ai.chatStream(
        ledgerId,
        userId,
        body,
        {
          start: (info) => emit("start", info),
          delta: (text) => emit("delta", { text }),
          card: (card) => emit("card", { card }),
        },
        run?.signal,
        images ?? [],
      );
      emit("done", result);
    } catch (error) {
      // 头已发出、全局过滤器接不到，非业务异常在这里留痕，否则前端只看到一句「出错了」无从排查。
      if (!(error instanceof AppError)) this.logger.error(error);
      emit("error", {
        message: error instanceof AppError ? error.message : "AI 服务出错，请稍后重试",
        code: error instanceof AppError ? error.code : "AI_INTERNAL_ERROR",
      });
    } finally {
      run?.release();
      if (heartbeat) clearInterval(heartbeat);
      response.end();
    }
  }

  /** 断连恢复：按 requestId 查一轮流式聊天的状态（running/done/lost/unknown，见 service）。 */
  @Get("chat/stream/:requestId")
  @ApiOkResponse()
  chatRunStatus(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
  ) {
    const userId = (auth as SessionAuthContext).userId;
    // 传函数而非快照：service 在查库之后再判断是否仍在运行，避免与刚登记的轮次竞态误判 lost。
    return this.ai.getChatRunStatus(ledgerId, userId, requestId, () =>
      this.runs.isRunning(ledgerId, userId, requestId),
    );
  }

  /** 显式停止一轮流式聊天（只能停本人在该账本的）。该轮已结束或从未开始时静默成功。 */
  @Post("chat/stream/:requestId/cancel")
  @ApiOkResponse()
  async cancelChatStream(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
  ) {
    await this.ai.assertLedgerMember(ledgerId, (auth as SessionAuthContext).userId);
    this.runs.cancel(ledgerId, (auth as SessionAuthContext).userId, requestId);
    return { ok: true };
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

  @Patch("messages/:messageId/drafts")
  @ApiOkResponse()
  updateDraftCards(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("messageId") messageId: string,
    @Body() body: UpdateDraftCardsDto,
  ) {
    return this.ai.updateDraftCards(ledgerId, messageId, (auth as SessionAuthContext).userId, body);
  }
}
