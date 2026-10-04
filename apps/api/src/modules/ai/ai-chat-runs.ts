import { Injectable } from "@nestjs/common";
import { AppError } from "@fin-nest/backend";

/** 取消请求可能先于本轮登记到达（上传尚未收完就点了停止），墓碑保留这么久等登记来认领。 */
const CANCEL_TOMBSTONE_MS = 60_000;

/**
 * 进行中的流式聊天轮次登记表（进程内，单 API 实例即可）。
 *
 * 流式聊天不再随客户端连接断开而中止：iOS Safari 切到别的 App 时会掐断页面上的请求，
 * 识图一轮动辄几十秒，断开即中止会让整轮白跑。现在连接断了服务端照样跑完并落库，
 * 前端回来后按 requestId 查轮次状态（GET chat/stream/:requestId）恢复；只有用户显式点「停止」（带 requestId 调取消接口）才中止。
 */
@Injectable()
export class AiChatRuns {
  private readonly running = new Map<string, AbortController>();
  private readonly cancelled = new Map<string, number>();

  /** 登记一轮；若此前已收到它的取消请求，返回的 signal 直接处于中止态。同一 requestId 不能并发两轮。 */
  register(
    ledgerId: string,
    userId: string,
    requestId: string,
  ): { signal: AbortSignal; release: () => void } {
    const key = this.key(ledgerId, userId, requestId);
    if (this.running.has(key)) {
      throw new AppError("AI_DUPLICATE_REQUEST", "这条消息已经发送过了", 409);
    }
    const controller = new AbortController();
    this.pruneTombstones();
    if (this.cancelled.delete(key)) controller.abort();
    this.running.set(key, controller);
    return {
      signal: controller.signal,
      release: () => {
        if (this.running.get(key) === controller) this.running.delete(key);
      },
    };
  }

  isRunning(ledgerId: string, userId: string, requestId: string): boolean {
    return this.running.has(this.key(ledgerId, userId, requestId));
  }

  /** 中止本人在该账本的某一轮；尚未登记时记墓碑，登记时立即中止。 */
  cancel(ledgerId: string, userId: string, requestId: string): void {
    const key = this.key(ledgerId, userId, requestId);
    const controller = this.running.get(key);
    if (controller) {
      controller.abort();
      return;
    }
    this.pruneTombstones();
    this.cancelled.set(key, Date.now() + CANCEL_TOMBSTONE_MS);
  }

  private pruneTombstones(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.cancelled) {
      if (expiresAt <= now) this.cancelled.delete(key);
    }
  }

  // 账本也进键：本人在 A 账本的轮次不能经 B 账本的接口查询或取消。
  private key(ledgerId: string, userId: string, requestId: string): string {
    return `${ledgerId}:${userId}:${requestId}`;
  }
}
