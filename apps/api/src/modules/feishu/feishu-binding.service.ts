import { randomInt } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  PrismaService,
} from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { LedgersService } from "../ledgers/ledgers.service";
import { hashOpaqueToken } from "../auth/token-utils";

// 绑定码要在手机上手打，不能用 32 字节 base64url。
// 字符集去掉 0/O/1/I/L 这几组易混字符；8 位 × 31 字符 ≈ 39.6 bit，
// 配合 10 分钟有效期与失败限速足够抗枚举。
const BIND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BIND_CODE_LENGTH = 8;
const BIND_CODE_TTL_MS = 10 * 60 * 1000;

// 按 open_id 限制绑定码尝试失败次数，对齐登录限速的思路（内存实现，单实例假设）。
const BIND_MAX_FAILURES = 5;
const BIND_WINDOW_MS = 15 * 60 * 1000;

export type FeishuBindingSummary = {
  id: string;
  displayName: string | null;
  openIdSuffix: string;
  currentLedgerId: string;
  currentLedgerName: string | null;
  createdAt: Date;
};

/**
 * 账本维度的绑定摘要，供「选择推送接收人」用。
 *
 * 比 {@link FeishuBindingSummary} 多了 userId/userAlias（要让人分清这是谁的飞书号），
 * 少了 currentLedger*（接收人选择与对方当前停留在哪个账本无关）。
 */
export type LedgerFeishuBindingSummary = {
  id: string;
  displayName: string | null;
  openIdSuffix: string;
  userId: string;
  userAlias: string;
};

export type CreatedBindCode = {
  /** 明文绑定码，仅此一次返回；库中只存 sha256。 */
  code: string;
  expiresAt: Date;
};

class BindRateLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(key: string): void {
    this.prune();
    const entry = this.failures.get(key);
    if (entry && entry.count >= BIND_MAX_FAILURES && entry.resetAt > Date.now()) {
      throw new AppError("FEISHU_BIND_RATE_LIMITED", "绑定尝试过于频繁，请 15 分钟后再试", 429);
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + BIND_WINDOW_MS });
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

/**
 * 飞书账号绑定。
 *
 * 两侧调用者：
 * - Web（`FeishuBindController`，session 鉴权）：生成绑定码、查看与解除绑定；
 * - 飞书事件处理（P2）：消费绑定码、按 open_id 解析身份、切换账本。
 *
 * 关键约束见 docs/FEISHU_BOT_PLAN.md §5：绑定码一次性且必须原子消费，
 * 解绑走软删且「同一 open_id 同时只有一条生效绑定」由部分唯一索引保证。
 */
@Injectable()
export class FeishuBindingService {
  private readonly config = loadConfig();
  private readonly rateLimiter = new BindRateLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: DatabaseTransactionService,
    private readonly ledgers: LedgersService,
    private readonly audit: AuditLogService,
  ) {}

  /** 两个环境变量都配置才算启用；未启用时 Web 侧接口直接报错、前端隐藏入口。 */
  get enabled(): boolean {
    return Boolean(this.config.FEISHU_APP_ID && this.config.FEISHU_APP_SECRET);
  }

  status(): { enabled: boolean } {
    return { enabled: this.enabled };
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new AppError("FEISHU_NOT_CONFIGURED", "飞书机器人未配置", 400);
    }
  }

  // ---------------------------------------------------------------- Web 侧

  /**
   * 生成一次性绑定码。绑定码携带 (userId, ledgerId)，用户在飞书私聊里发给机器人完成绑定。
   * 同一用户此前未使用的码会被一并作废，避免多个有效码同时飘着。
   */
  async createBindCode(ledgerId: string, userId: string): Promise<CreatedBindCode> {
    this.assertEnabled();
    await this.ledgers.assertMember(ledgerId, userId);

    const code = generateBindCode();
    const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS);

    await this.tx.run(async (tx) => {
      await tx.feishuBindCode.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.feishuBindCode.create({
        data: { codeHash: hashOpaqueToken(normalizeBindCode(code)), userId, ledgerId, expiresAt },
      });
    });

    return { code, expiresAt };
  }

  /** 列出当前用户的生效绑定。绑定是用户级的，不做账本隔离。 */
  async listBindings(userId: string): Promise<FeishuBindingSummary[]> {
    this.assertEnabled();
    const bindings = await this.prisma.client.feishuBinding.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (bindings.length === 0) return [];

    // schema 未定义关系字段，账本名单独查一次再拼。
    const ledgers = await this.prisma.client.ledger.findMany({
      where: { id: { in: bindings.map((b) => b.currentLedgerId) }, deletedAt: null },
      select: { id: true, name: true },
    });
    const ledgerNames = new Map(ledgers.map((l) => [l.id, l.name]));

    return bindings.map((binding) => ({
      id: binding.id,
      displayName: binding.displayName,
      openIdSuffix: binding.openId.slice(-6),
      currentLedgerId: binding.currentLedgerId,
      currentLedgerName: ledgerNames.get(binding.currentLedgerId) ?? null,
      createdAt: binding.createdAt,
    }));
  }

  /**
   * 列出本账本所有成员的生效绑定，供订阅等业务选择推送接收人。
   *
   * 与 {@link listBindings} 的差别在范围：那个是「我的账号管理」，这个是「谁能收到本账本的推送」，
   * 所以按账本成员展开——家庭账本里给配偶推送到期提醒是主要场景。
   *
   * 未配置飞书时返回空数组而非报错：调用方（订阅表单）据此静默隐藏入口，
   * 不需要为「没开这个功能」写一条错误分支。
   */
  async listLedgerBindings(ledgerId: string, userId: string): Promise<LedgerFeishuBindingSummary[]> {
    await this.ledgers.assertMember(ledgerId, userId);
    if (!this.enabled) return [];

    const members = await this.prisma.client.ledgerMember.findMany({
      where: { ledgerId, removedAt: null },
      select: { userId: true },
    });
    if (members.length === 0) return [];
    const memberIds = members.map((member) => member.userId);

    const [bindings, users] = await Promise.all([
      this.prisma.client.feishuBinding.findMany({
        where: { userId: { in: memberIds }, revokedAt: null },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, alias: true },
      }),
    ]);
    const aliasByUserId = new Map(users.map((user) => [user.id, user.alias]));

    return bindings.map((binding) => ({
      id: binding.id,
      displayName: binding.displayName,
      openIdSuffix: binding.openId.slice(-6),
      userId: binding.userId,
      userAlias: aliasByUserId.get(binding.userId) ?? "",
    }));
  }

  /** 解绑（软删）。只能解除自己的绑定。 */
  async revokeBinding(bindingId: string, userId: string): Promise<void> {
    this.assertEnabled();
    // 带 userId 条件的 updateMany：不存在与不属于自己合并为同一结果，不泄漏他人绑定是否存在。
    const revoked = await this.prisma.client.feishuBinding.updateMany({
      where: { id: bindingId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new AppError("FEISHU_BINDING_NOT_FOUND", "绑定不存在", 404);
    }
    await this.audit.write({
      actorUserId: userId,
      source: "user",
      action: "feishu.unbind",
      entityType: "feishu_binding",
      entityId: bindingId,
    });
  }

  // -------------------------------------------------------------- 飞书事件侧

  /**
   * 消费绑定码并建立绑定。
   *
   * 「先查再改」在并发下会让两条绑定消息都通过，因此用带条件的 updateMany 抢占
   * （与「确认待确认交易」同一手法），整体放在事务里：
   * 抢占失败 → 码无效/已用/过期；抢占成功 → 软删该 open_id 的旧绑定，再插入新绑定。
   *
   * 绑定码有 10 分钟有效期，生成时校验过的账本在此期间可能失效，因此抢占成功后
   * 还要在事务内二次校验账本未删除、用户仍是成员（见下方），避免绑到失效账本上。
   *
   * 刻意不接收昵称：拉昵称要打飞书通讯录接口，放在这之前等于让错码 / 已被限速的尝试
   * 也能触发出站调用（限速在本方法第二行）。昵称由调用方在绑定成功后经 setDisplayName 补写。
   */
  async consumeBindCode(input: {
    code: string;
    openId: string;
    unionId?: string | null;
  }): Promise<{ userId: string; ledgerId: string }> {
    this.assertEnabled();
    this.rateLimiter.assertAllowed(input.openId);

    const codeHash = hashOpaqueToken(normalizeBindCode(input.code));
    const now = new Date();

    try {
      const result = await this.tx.run(async (tx) => {
        const claimed = await tx.feishuBindCode.updateMany({
          where: { codeHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count === 0) {
          throw new AppError("FEISHU_BIND_CODE_INVALID", "绑定码无效或已过期", 400);
        }

        const bindCode = await tx.feishuBindCode.findUnique({ where: { codeHash } });
        if (!bindCode) {
          throw new AppError("FEISHU_BIND_CODE_INVALID", "绑定码无效或已过期", 400);
        }

        // 二次校验绑定码指向的账本仍然可用：码生成时（createBindCode）校验过一次，但码有
        // 10 分钟有效期，期间账本可能被软删、用户可能被移出成员。若此时不拦下，绑定会显示
        // 成功，用户发消息时才在 assertMember 处报「账本不存在」，体验割裂。
        // 校验失败抛错即回滚事务，绑定码不被消耗（仍按 10 分钟自然过期）。
        const ledger = await tx.ledger.findFirst({
          where: { id: bindCode.ledgerId, deletedAt: null },
          select: { id: true },
        });
        if (!ledger) {
          throw new AppError(
            "FEISHU_BIND_LEDGER_GONE",
            "绑定码对应的账本已删除，请到网页端选择其他账本重新生成绑定码",
            400,
          );
        }
        const membership = await tx.ledgerMember.findFirst({
          where: { ledgerId: bindCode.ledgerId, userId: bindCode.userId, removedAt: null },
          select: { id: true },
        });
        if (!membership) {
          throw new AppError("FEISHU_BIND_NOT_MEMBER", "你已不再是该账本的成员，无法绑定", 400);
        }

        // 部分唯一索引要求同一 open_id 同时只有一条生效绑定，重复绑定即换绑。
        await tx.feishuBinding.updateMany({
          where: { openId: input.openId, revokedAt: null },
          data: { revokedAt: now },
        });
        const binding = await tx.feishuBinding.create({
          data: {
            openId: input.openId,
            unionId: input.unionId ?? null,
            userId: bindCode.userId,
            currentLedgerId: bindCode.ledgerId,
          },
        });

        await this.audit.write(
          {
            ledgerId: bindCode.ledgerId,
            actorUserId: bindCode.userId,
            source: "user",
            action: "feishu.bind",
            entityType: "feishu_binding",
            entityId: binding.id,
          },
          tx,
        );

        return { userId: bindCode.userId, ledgerId: bindCode.ledgerId };
      });

      this.rateLimiter.recordSuccess(input.openId);
      return result;
    } catch (error) {
      // 只对「码不对」计失败：数据库瞬时故障不该把用户锁在门外。
      if (error instanceof AppError && error.code === "FEISHU_BIND_CODE_INVALID") {
        this.rateLimiter.recordFailure(input.openId);
      }
      throw error;
    }
  }

  /**
   * 绑定成功后补写飞书昵称（供 Web 端辨认「绑的是哪个飞书号」）。
   *
   * 与绑定分开是为了让拉昵称的出站调用只发生在绑定确实成功之后（见 consumeBindCode 注释）。
   * 昵称是纯展示字段，拿不到就保持 null，Web 端降级显示 open_id 尾段。
   */
  async setDisplayName(openId: string, displayName: string | null): Promise<void> {
    if (!displayName) return;
    await this.prisma.client.feishuBinding.updateMany({
      where: { openId, revokedAt: null },
      data: { displayName },
    });
  }

  /** 按 open_id 解析身份；未绑定返回 null（调用方引导去 Web 生成绑定码）。 */
  async resolveBinding(openId: string) {
    return this.prisma.client.feishuBinding.findFirst({
      where: { openId, revokedAt: null },
    });
  }

  /**
   * 切换当前账本。校验成员身份后更新绑定。
   * 会话重置由调用方负责——旧上下文里全是前一个账本的分类与账户 id，留着会误导模型。
   */
  async switchLedger(openId: string, ledgerId: string): Promise<void> {
    const binding = await this.resolveBinding(openId);
    if (!binding) {
      throw new AppError("FEISHU_NOT_BOUND", "尚未绑定", 403);
    }
    await this.ledgers.assertMember(ledgerId, binding.userId);
    await this.prisma.client.feishuBinding.update({
      where: { id: binding.id },
      data: { currentLedgerId: ledgerId },
    });
  }

  /** 飞书侧「解绑」指令。未绑定时返回 false，由调用方决定话术。 */
  async revokeByOpenId(openId: string): Promise<boolean> {
    const revoked = await this.prisma.client.feishuBinding.updateMany({
      where: { openId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count > 0;
  }
}

/** 分组展示（`K7M4-P2QX`）纯为好读，校验前一律先 normalize 掉分隔符。 */
export function generateBindCode(): string {
  let raw = "";
  for (let i = 0; i < BIND_CODE_LENGTH; i++) {
    // randomInt 内部做拒绝采样，不会有取模偏置。
    raw += BIND_CODE_ALPHABET[randomInt(BIND_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** 用户可能带着分隔符、空格或小写输入；统一大写并去掉非字母数字后再比对。 */
export function normalizeBindCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
