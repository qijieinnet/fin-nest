import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "@fin-nest/config";
import { AppError } from "../errors/app-error";

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

/** `/authen/v2/oauth/token` 是标准 OAuth 响应：字段在顶层，不套 `data`，失败时带 error 描述。 */
type OAuthTokenResponse = {
  code?: number;
  msg?: string;
  error?: string;
  error_description?: string;
  access_token?: string;
};

type FeishuUserInfo = {
  open_id?: string;
  union_id?: string;
  name?: string;
};

/** 网页免登解析出的飞书身份。`displayName` 拿不到不影响绑定，只影响展示。 */
export type FeishuUserIdentity = {
  openId: string;
  unionId: string | null;
  displayName: string | null;
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

  /** 发送纯文本消息到会话。 */
  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage("chat_id", chatId, "text", JSON.stringify({ text }));
  }

  /**
   * 发送交互卡片到会话。
   *
   * 卡片的**更新**不走这里，也不走 `PATCH /im/v1/messages`——按钮点击后的更新必须由
   * `card.action.trigger` 的回调响应带回去（见 `feishu-card-action.service.ts`）。
   */
  async sendCard(chatId: string, card: unknown): Promise<string | undefined> {
    return this.sendMessage("chat_id", chatId, "interactive", JSON.stringify(card));
  }

  /**
   * 主动推送纯文本给某个飞书用户（机器人单聊）。
   *
   * 与 {@link sendText} 的区别只在收件标识：这里按 open_id 投递，用于「用户没先说话、
   * 系统主动找他」的场景（订阅到期提醒等）。要求该用户在应用可用范围内，否则飞书报错。
   */
  async sendTextToUser(openId: string, text: string): Promise<string | undefined> {
    return this.sendMessage("open_id", openId, "text", JSON.stringify({ text }));
  }

  /** 主动推送交互卡片给某个飞书用户，语义同 {@link sendTextToUser}。 */
  async sendCardToUser(openId: string, card: unknown): Promise<string | undefined> {
    return this.sendMessage("open_id", openId, "interactive", JSON.stringify(card));
  }

  /**
   * 给消息加表情回复，返回 reaction_id（删除时要用）。
   *
   * 用途是「正在处理」的可视反馈：AI 一轮对话含最多 6 轮工具循环，几十秒里用户
   * 看不到任何动静，容易以为机器人死了。
   *
   * 失败一律吞掉返回 null：表情是锦上添花，绝不能因为没开 `im:message.reactions:write_only`
   * 权限就挡住真正的回复（发消息走 `im:message:send_as_bot`，是另一套权限）。
   */
  async addReaction(messageId: string, emojiType: string): Promise<string | null> {
    try {
      const data = await this.request<{ reaction_id?: string }>(
        "POST",
        `/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
        { reaction_type: { emoji_type: emojiType } },
      );
      return data?.reaction_id ?? null;
    } catch (error) {
      this.logger.warn(
        `添加飞书表情回复失败（需开通 im:message.reactions:write_only 权限，不影响正常回复）：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 撤掉 {@link addReaction} 加的表情。同样吞掉失败——残留一个表情不值得打断流程。 */
  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      await this.request(
        "DELETE",
        `/im/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionId)}`,
      );
    } catch (error) {
      this.logger.warn(
        `移除飞书表情回复失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取用户昵称，用于在 Web 端认出「绑的是哪个飞书号」。
   *
   * 需要应用开通 `contact:user.base:readonly` 权限且用户在通讯录可见范围内；未开通或
   * 查询失败时返回 null——绑定流程据此降级为「飞书账号 ···尾段」，**不阻断绑定**。
   */
  async getUserDisplayName(openId: string): Promise<string | null> {
    try {
      const data = await this.request<{ user?: { name?: string } }>(
        "GET",
        `/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
      );
      const name = data?.user?.name;
      return name && name.length > 0 ? name : null;
    } catch (error) {
      this.logger.warn(
        `获取飞书用户昵称失败，绑定将不显示昵称：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 用网页授权码换取飞书身份（open_id / union_id / 昵称），供飞书容器内免登用。
   *
   * 走的是与机器人完全不同的一条鉴权链：这里拿的是 **user_access_token**（代表某个具体用户），
   * 而 {@link request} 用的是 tenant_access_token（代表应用本身），因此不能复用 `request`。
   *
   * `redirectUri` 必须与前端发起授权时用的完全一致，否则飞书拒绝换取；由调用方透传。
   * 授权码 5 分钟有效且一次性，换取失败一律按「身份未验证」抛 401，交由上层回落密码登录。
   */
  async exchangeOAuthCode(code: string, redirectUri?: string): Promise<FeishuUserIdentity> {
    const { FEISHU_APP_ID, FEISHU_APP_SECRET } = this.config;
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      throw new AppError("FEISHU_NOT_CONFIGURED", "飞书应用未配置", 400);
    }

    const tokenResponse = await this.fetchWithTimeout(`${FEISHU_BASE_URL}/authen/v2/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: FEISHU_APP_ID,
        client_secret: FEISHU_APP_SECRET,
        code,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      }),
    });
    const tokenPayload = (await tokenResponse.json()) as OAuthTokenResponse;
    if (tokenPayload.code !== 0 || !tokenPayload.access_token) {
      const detail = tokenPayload.error_description ?? tokenPayload.error ?? tokenPayload.msg ?? "";
      throw new AppError("FEISHU_OAUTH_FAILED", `飞书授权码无效：${detail}`, 401);
    }

    const infoResponse = await this.fetchWithTimeout(`${FEISHU_BASE_URL}/authen/v1/user_info`, {
      method: "GET",
      headers: { authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const infoPayload = (await infoResponse.json()) as FeishuApiResponse<FeishuUserInfo>;
    const openId = infoPayload.data?.open_id;
    if (infoPayload.code !== 0 || !openId) {
      throw new AppError(
        "FEISHU_OAUTH_FAILED",
        `获取飞书用户信息失败：${infoPayload.msg} (code=${infoPayload.code})`,
        502,
      );
    }

    return {
      openId,
      unionId: infoPayload.data?.union_id ?? null,
      displayName: infoPayload.data?.name ?? null,
    };
  }

  private async sendMessage(
    receiveIdType: "chat_id" | "open_id",
    receiveId: string,
    msgType: string,
    content: string,
  ): Promise<string | undefined> {
    const data = await this.request<{ message_id?: string }>(
      "POST",
      `/im/v1/messages?receive_id_type=${receiveIdType}`,
      { receive_id: receiveId, msg_type: msgType, content },
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
