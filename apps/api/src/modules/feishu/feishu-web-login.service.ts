import { Injectable, Logger } from "@nestjs/common";
import { AppError, AuditLogService, FeishuClient } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { AuthService, type PublicUser } from "../auth/auth.service";
import type { RequestWithAuth } from "../auth/auth.types";
import { clientIpFromRequest } from "../auth/ip-utils";
import { createOpaqueToken } from "../auth/token-utils";
import { LedgersService } from "../ledgers/ledgers.service";
import { FeishuBindingService } from "./feishu-binding.service";

// 待绑定票据：免登时飞书身份已核实但本地还没有对应账号，先把 open_id 暂存起来，
// 等用户在登录页用账号密码证明「我是谁」，再把两者接上。
const BIND_TICKET_TTL_MS = 10 * 60 * 1000;
const BIND_TICKET_MAX = 500;

// 换码失败按来源 IP 限速。这个接口是公开的，且每次调用都会往飞书打一次出站请求——
// 不限速等于给了任何人一个「借你的服务器刷飞书接口」的放大器，真被刷到限流会连
// 机器人一起哑掉。只计失败：正常用户一次就成功，连续失败才是滥用信号。
const EXCHANGE_MAX_FAILURES = 30;
const EXCHANGE_WINDOW_MS = 15 * 60 * 1000;

type PendingBind = {
  openId: string;
  unionId: string | null;
  displayName: string | null;
  expiresAt: number;
};

/** 与登录/绑定码限速器同构的内存实现（单实例自部署前提，多实例需换共享存储）。 */
class ExchangeRateLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(key: string): void {
    this.prune();
    const entry = this.failures.get(key);
    if (entry && entry.count >= EXCHANGE_MAX_FAILURES && entry.resetAt > Date.now()) {
      throw new AppError("FEISHU_LOGIN_RATE_LIMITED", "免登尝试过于频繁，请稍后再试", 429);
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + EXCHANGE_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  private prune(): void {
    if (this.failures.size < 1000) return;
    const now = Date.now();
    for (const [key, entry] of this.failures) {
      if (entry.resetAt <= now) this.failures.delete(key);
    }
  }
}

export type FeishuWebLoginConfig = {
  enabled: boolean;
  /** App ID 本身就会出现在授权跳转的 URL 里，属于公开信息，可以下发给未登录页面。 */
  appId: string | null;
};

export type FeishuSilentLoginResult =
  | { status: "authenticated"; user: PublicUser; token: string; expiresAt: Date }
  /** 该飞书号还没绑定本地账号：前端存下 bindTicket，引导用户登录一次即自动绑定。 */
  | { status: "unbound"; bindTicket: string; displayName: string | null };

/**
 * 飞书容器内的网页免登。
 *
 * 流程（详见 docs/FEISHU_BOT_PLAN.md）：前端识别到飞书 UA 且本地无 token → 跳飞书授权页
 * （用户已在飞书登录，不弹任何交互）→ 带 `code` 回跳 → 本服务用 code 换 open_id →
 * 命中 `FeishuBinding` 则直接签发会话，否则发一张待绑定票据让用户登录一次。
 *
 * **刻意不自动建号**：飞书 App 的可用范围往往是整个租户，自动建号等于把记账系统对全公司敞开。
 * 绑定关系与机器人共用同一张 `feishu_bindings` 表，绑过之后机器人记账与网页免登都认这一条。
 */
@Injectable()
export class FeishuWebLoginService {
  private readonly logger = new Logger(FeishuWebLoginService.name);
  private readonly config = loadConfig();
  // 票据只活 10 分钟，丢了最多让用户重走一次授权，因此不落库（与本模块限速器同样的单实例假设）。
  private readonly pendingBinds = new Map<string, PendingBind>();
  private readonly exchangeRateLimiter = new ExchangeRateLimiter();

  constructor(
    private readonly client: FeishuClient,
    private readonly binding: FeishuBindingService,
    private readonly auth: AuthService,
    private readonly ledgers: LedgersService,
    private readonly audit: AuditLogService,
  ) {}

  /** 公开读取：未配置飞书时前端直接跳过免登，不做任何跳转。 */
  publicConfig(): FeishuWebLoginConfig {
    const enabled = Boolean(this.config.FEISHU_APP_ID && this.config.FEISHU_APP_SECRET);
    return { enabled, appId: enabled ? (this.config.FEISHU_APP_ID ?? null) : null };
  }

  async silentLogin(
    input: { code: string; redirectUri?: string },
    request: RequestWithAuth,
  ): Promise<FeishuSilentLoginResult> {
    if (!this.publicConfig().enabled) {
      throw new AppError("FEISHU_NOT_CONFIGURED", "飞书应用未配置", 400);
    }

    const rateKey = clientIpFromRequest(request, this.config.TRUST_PROXY) ?? "unknown";
    this.exchangeRateLimiter.assertAllowed(rateKey);

    let identity: Awaited<ReturnType<FeishuClient["exchangeOAuthCode"]>>;
    try {
      identity = await this.client.exchangeOAuthCode(input.code, input.redirectUri);
    } catch (error) {
      this.exchangeRateLimiter.recordFailure(rateKey);
      throw error;
    }
    this.exchangeRateLimiter.recordSuccess(rateKey);

    const binding = await this.binding.resolveBinding(identity.openId);
    if (!binding) {
      return {
        status: "unbound",
        bindTicket: this.issueBindTicket(identity),
        displayName: identity.displayName,
      };
    }

    // 昵称是机器人绑定时可能没取到的字段（依赖通讯录权限），免登这条路顺手就有，补上。
    if (identity.displayName && identity.displayName !== binding.displayName) {
      await this.binding.setDisplayName(identity.openId, identity.displayName);
    }

    const result = await this.auth.createSessionForVerifiedUser(binding.userId, "飞书", request);
    await this.audit.write({
      source: "user",
      actorUserId: binding.userId,
      action: "auth.feishu_login",
      entityType: "feishu_binding",
      entityId: binding.id,
    });
    return { status: "authenticated", ...result };
  }

  /**
   * 消费待绑定票据，把当前登录用户与票据里的飞书号绑上，此后该飞书号即可免登。
   *
   * 票据一次性：先删再用，重放拿不到第二次。默认账本取用户最早加入的那个，与机器人绑定码
   * 的语义一致（都是「先给个能用的默认值」），用户之后可在飞书里 `切换账本`。
   */
  async completeBind(ticket: string, userId: string): Promise<{ bindingId: string }> {
    const pending = this.consumeBindTicket(ticket);
    if (!pending) {
      throw new AppError("FEISHU_BIND_TICKET_INVALID", "绑定凭证已失效，请重新打开应用", 400);
    }

    const ledgers = await this.ledgers.listForUser(userId);
    const ledger = ledgers[0];
    if (!ledger) {
      throw new AppError("FEISHU_BIND_NO_LEDGER", "当前账号还没有账本，无法绑定飞书", 400);
    }

    return this.binding.bindOpenId({
      openId: pending.openId,
      unionId: pending.unionId,
      displayName: pending.displayName,
      userId,
      ledgerId: ledger.id,
    });
  }

  private issueBindTicket(identity: {
    openId: string;
    unionId: string | null;
    displayName: string | null;
  }): string {
    this.pruneBindTickets();
    const ticket = createOpaqueToken("fn_fsbind");
    this.pendingBinds.set(ticket, {
      openId: identity.openId,
      unionId: identity.unionId,
      displayName: identity.displayName,
      expiresAt: Date.now() + BIND_TICKET_TTL_MS,
    });
    return ticket;
  }

  private consumeBindTicket(ticket: string): PendingBind | null {
    const pending = this.pendingBinds.get(ticket);
    if (!pending) return null;
    this.pendingBinds.delete(ticket);
    return pending.expiresAt > Date.now() ? pending : null;
  }

  private pruneBindTickets(): void {
    const now = Date.now();
    for (const [key, pending] of this.pendingBinds) {
      if (pending.expiresAt <= now) this.pendingBinds.delete(key);
    }
    // 过期项清完仍然超量说明有人在刷接口（每张票都要一次有效授权码，成本不低），
    // 直接清空止损：影响面只是让正在绑定的用户重走一次授权。
    if (this.pendingBinds.size > BIND_TICKET_MAX) {
      this.logger.warn("待绑定票据数量异常，已全部清空");
      this.pendingBinds.clear();
    }
  }
}
