import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
/** tenant_access_token 服务端返回剩余秒数；提前 5 分钟续期，避免边界过期。 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

type TenantTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

type FeishuApiResponse<T> = {
  code: number;
  msg: string;
  data?: T;
};

/**
 * 飞书开放平台的薄客户端（自写 fetch，风格对齐 `llm-client.ts`）。
 * SDK 只用来维持长连接，业务调用走这里，省得把整个 SDK 的 client 拖进来。
 */
@Injectable()
export class FeishuClient {
  private readonly logger = new Logger(FeishuClient.name);
  private readonly config = loadConfig();
  private cachedToken: { token: string; expiresAt: number } | null = null;
  /** 并发续期时共享同一个在途请求，避免同时打多次 token 接口。 */
  private pendingToken: Promise<string> | null = null;

  get enabled(): boolean {
    return Boolean(this.config.FEISHU_APP_ID && this.config.FEISHU_APP_SECRET);
  }

  /** 发送纯文本消息。 */
  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, "text", JSON.stringify({ text }));
  }

  /**
   * 发送交互卡片。
   *
   * 卡片的**更新**不走这里，也不走 `PATCH /im/v1/messages`——按钮点击后的更新必须由
   * `card.action.trigger` 的回调响应带回去（见 `feishu-card-action.service.ts`）。
   */
  async sendCard(chatId: string, card: unknown): Promise<string | undefined> {
    return this.sendMessage(chatId, "interactive", JSON.stringify(card));
  }

  private async sendMessage(
    chatId: string,
    msgType: string,
    content: string,
  ): Promise<string | undefined> {
    const data = await this.request<{ message_id?: string }>(
      "POST",
      "/im/v1/messages?receive_id_type=chat_id",
      { receive_id: chatId, msg_type: msgType, content },
    );
    return data?.message_id;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const token = await this.getTenantAccessToken();
    const response = await this.fetchWithTimeout(`${FEISHU_BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = (await response.json()) as FeishuApiResponse<T>;
    if (payload.code !== 0) {
      // token 失效（99991663 等）时清缓存，下次调用重新获取。
      this.cachedToken = null;
      throw new AppError(
        "FEISHU_API_ERROR",
        `飞书接口调用失败：${payload.msg} (code=${payload.code})`,
        502,
      );
    }
    return payload.data;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.token;
    }
    if (this.pendingToken) return this.pendingToken;

    this.pendingToken = this.fetchTenantAccessToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchTenantAccessToken(): Promise<string> {
    const { FEISHU_APP_ID, FEISHU_APP_SECRET } = this.config;
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      throw new AppError("FEISHU_NOT_CONFIGURED", "飞书机器人未配置", 400);
    }

    const response = await this.fetchWithTimeout(
      `${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
      },
    );

    const payload = (await response.json()) as TenantTokenResponse;
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new AppError(
        "FEISHU_AUTH_FAILED",
        `获取 tenant_access_token 失败：${payload.msg} (code=${payload.code})`,
        502,
      );
    }

    const ttlMs = (payload.expire ?? 7200) * 1000;
    this.cachedToken = {
      token: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, 60_000),
    };
    this.logger.log("已刷新飞书 tenant_access_token");
    return this.cachedToken.token;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new AppError(
        "FEISHU_API_UNREACHABLE",
        `调用飞书接口失败：${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
