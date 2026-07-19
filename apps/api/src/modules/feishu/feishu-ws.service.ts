import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as Lark from "@larksuiteoapi/node-sdk";
import { loadConfig } from "@fin-nest/config";
import {
  FeishuCardActionService,
  normalizeCardAction,
  type CardActionResponse,
} from "./feishu-card-action.service";
import { extractEventId } from "./feishu-events";
import { FeishuInboxService } from "./feishu-inbox.service";

/**
 * 飞书长连接。相比 webhook 不需要公网回调地址，因而也不需要
 * Encrypt Key 解密、签名校验与 challenge 握手（见 docs/FEISHU_BOT_PLAN.md §2）。
 *
 * 两类回调的处理策略刻意不同（SDK 是 await 完 handler 才发 ack）：
 * - **消息事件**：只落库、立即返回。绝不在此 await LLM——一轮对话含最多 6 轮工具循环。
 * - **卡片按钮**：同步处理。只有几次数据库写、不调 LLM，秒级完成，
 *   走收件箱反而要等一个轮询周期，点按钮的手感会明显发木。
 */
@Injectable()
export class FeishuWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeishuWsService.name);
  private readonly config = loadConfig();
  private client: Lark.WSClient | null = null;

  constructor(
    private readonly inbox: FeishuInboxService,
    private readonly cardActions: FeishuCardActionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { FEISHU_APP_ID, FEISHU_APP_SECRET } = this.config;
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      this.logger.log("未配置 FEISHU_APP_ID/FEISHU_APP_SECRET，跳过飞书长连接");
      return;
    }

    this.client = new Lark.WSClient({
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      // info 级别会输出 SDK 自身的连接与事件分发日志。长连接「连上了但收不到事件」
      // 基本都是开放平台侧的订阅/权限没配好，这些日志是唯一的线索来源。
      loggerLevel: Lark.LoggerLevel.info,
    });

    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        await this.enqueue("im.message.receive_v1", data);
      },
      // 卡片按钮属于「回调」而非「事件」，但长连接下同样经 EventDispatcher 分发；
      // IHandles 没有这个类型键，故需要 register 的泛型参数放行。
      // **返回值必须原样抛出去**：SDK 会把它随 ack 回传，飞书据此替换卡片。
      "card.action.trigger": async (data: unknown) => {
        return this.handleCardAction(data);
      },
    } as Parameters<Lark.EventDispatcher["register"]>[0]);

    try {
      await this.client.start({ eventDispatcher: dispatcher });
      this.inbox.start();
      this.logger.log(
        "飞书长连接已建立，已订阅：im.message.receive_v1（事件）、card.action.trigger（回调）",
      );
    } catch (error) {
      // 连接失败不应拖垮整个 API 启动：记账主链路与飞书无关。
      this.logger.error(
        `飞书长连接建立失败，飞书功能不可用：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client?.close();
    this.client = null;
  }

  /**
   * 卡片按钮同步处理（理由见类注释）。返回值会随 ack 回给飞书用于替换卡片，
   * 因此**必须把 service 的返回值透传出去**，返回 undefined 等于卡片不更新。
   */
  private async handleCardAction(data: unknown): Promise<CardActionResponse | undefined> {
    this.logger.log("收到飞书卡片操作 card.action.trigger");
    try {
      const action = normalizeCardAction(data);
      if (!action) {
        this.logger.warn(`无法解析的卡片操作，已忽略：${JSON.stringify(data).slice(0, 500)}`);
        return undefined;
      }
      return await this.cardActions.handleAction(action);
    } catch (error) {
      this.logger.error(
        `卡片操作处理失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return { toast: { type: "error", content: "处理失败，请稍后再试。" } };
    }
  }

  /**
   * 落库并立即返回。异常在此吞掉并记日志——抛出去会让 SDK 认为处理失败，
   * 而事件已经无法重放（飞书重推的是同一个 event_id，会被去重挡掉）。
   */
  private async enqueue(eventType: string, data: unknown): Promise<void> {
    // 到达即记一行：成功路径此前完全静默，出问题时无法区分「事件没来」和「来了但处理失败」。
    this.logger.log(`收到飞书事件 ${eventType}`);
    try {
      const eventId = extractEventId(data);
      if (!eventId) {
        this.logger.warn(
          `收到缺少 event_id 的飞书事件，无法去重，已丢弃：${JSON.stringify(data).slice(0, 500)}`,
        );
        return;
      }
      const isNew = await this.inbox.enqueue(eventId, eventType, data);
      this.logger.log(
        isNew ? `飞书事件 ${eventId} 已入队` : `飞书事件 ${eventId} 重复推送，已忽略`,
      );
    } catch (error) {
      this.logger.error(
        `飞书事件入队失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
