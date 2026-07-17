import { Injectable } from "@nestjs/common";
import { AppError, AuditLogService, DatabaseTransactionService, PrismaService } from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { SESSION_TTL_DAYS } from "./auth.constants";
import { RequestWithAuth, SessionAuthContext } from "./auth.types";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { loadConfig } from "@fin-nest/config";
import { addDays, createOpaqueToken, hashOpaqueToken, hashPassword, verifyPassword } from "./token-utils";
import { clientIpFromRequest } from "./ip-utils";
import { initializeLedgerDefaults } from "../ledgers/ledger-defaults";

export type PublicUser = {
  id: string;
  email: string;
  account: string;
  alias: string;
  isAdmin: boolean;
};

export type AuthResult = {
  user: PublicUser;
  token: string;
  expiresAt: Date;
};

export type AdminUser = {
  id: string;
  email: string;
  account: string;
  alias: string;
  isAdmin: boolean;
  disabledAt: Date | null;
  createdAt: Date;
};

// 登录失败限速：同一 登录名+IP 在窗口期内最多失败 N 次；
// 另按登录名单独设更高上限，防止换 IP（或伪造 XFF）绕过对单一账号的爆破限制。
// 内存实现，适用于单实例自部署；多实例部署需换成共享存储。
const LOGIN_MAX_FAILURES = 5;
const LOGIN_MAX_FAILURES_PER_ACCOUNT = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

class LoginRateLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(key: string, maxFailures: number): void {
    this.prune();
    const entry = this.failures.get(key);
    if (entry && entry.count >= maxFailures && entry.resetAt > Date.now()) {
      throw new AppError("TOO_MANY_LOGIN_ATTEMPTS", "登录失败次数过多，请 15 分钟后再试", 429);
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
  ) {}

  async register(input: RegisterDto, request: RequestWithAuth): Promise<AuthResult> {
    // 密码哈希（bcrypt）是 CPU 密集操作，放在事务外完成，避免占用 interactive transaction 时间预算。
    const passwordHash = await hashPassword(input.password);
    return this.txs.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(931733001)`;
      const userCount = await tx.user.count();
      const firstUser = userCount === 0;
      if (!firstUser) {
        const settings = await tx.appSetting.findUnique({ where: { id: 1 } });
        if (settings && !settings.registrationEnabled) {
          throw new AppError("REGISTRATION_DISABLED", "当前不允许开放注册", 403);
        }
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          account: input.account,
          alias: input.alias,
          passwordHash,
          isAdmin: firstUser,
        },
      });

      if (firstUser) {
        const ledger = await tx.ledger.create({
          data: {
            name: "默认账本",
            icon: "book",
            currency: "CNY",
            ownerUserId: user.id,
            createdBy: user.id,
          },
        });
        await tx.ledgerMember.create({
          data: { ledgerId: ledger.id, userId: user.id, role: "owner" },
        });
        await initializeLedgerDefaults(tx, ledger.id, user.id);
        await tx.appSetting.upsert({
          where: { id: 1 },
          create: { id: 1, registrationEnabled: true, updatedBy: user.id },
          update: { updatedBy: user.id },
        });
      }

      await this.audit.write(
        {
          source: "user",
          actorUserId: user.id,
          action: "auth.register",
          entityType: "user",
          entityId: user.id,
          metadata: { firstUser },
        },
        tx,
      );

      return this.createSessionForUser(user, input.deviceName, request, tx);
    }, { timeout: 20000 });
  }

  private readonly loginRateLimiter = new LoginRateLimiter();

  async login(input: LoginDto, request: RequestWithAuth): Promise<AuthResult> {
    const login = input.login.toLowerCase();
    const ipKey = `ip:${login}|${this.requestIp(request) ?? "unknown"}`;
    const accountKey = `acct:${login}`;
    this.loginRateLimiter.assertAllowed(ipKey, LOGIN_MAX_FAILURES);
    this.loginRateLimiter.assertAllowed(accountKey, LOGIN_MAX_FAILURES_PER_ACCOUNT);

    const user = await this.prisma.client.user.findFirst({
      where: {
        OR: [{ email: input.login }, { account: input.login }],
      },
    });
    if (!user || user.disabledAt || !(await verifyPassword(input.password, user.passwordHash))) {
      this.loginRateLimiter.recordFailure(ipKey);
      this.loginRateLimiter.recordFailure(accountKey);
      throw new AppError("INVALID_CREDENTIALS", "账号或密码错误", 401);
    }

    this.loginRateLimiter.recordSuccess(ipKey);
    this.loginRateLimiter.recordSuccess(accountKey);
    return this.createSessionForUser(user, input.deviceName, request);
  }

  async logout(auth: SessionAuthContext): Promise<void> {
    await this.prisma.client.session.update({
      where: { id: auth.sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async me(auth: SessionAuthContext): Promise<PublicUser> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return this.toPublicUser(user);
  }

  async changePassword(auth: SessionAuthContext, currentPassword: string, newPassword: string): Promise<void> {
    await this.txs.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new AppError("INVALID_CREDENTIALS", "当前密码错误", 401);
      }
      await tx.user.update({
        where: { id: auth.userId },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      await tx.session.updateMany({
        where: { userId: auth.userId, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.write(
        {
          source: "user",
          actorUserId: auth.userId,
          action: "auth.change_password",
          entityType: "user",
          entityId: auth.userId,
        },
        tx,
      );
    });
  }

  /**
   * 校验当前登录用户的密码（前端应用锁解锁用），不产生新 session。
   * 复用登录限速器按用户维度限失败次数，防止拿到有效 token 后经此接口爆破密码。
   */
  async verifyCurrentPassword(auth: SessionAuthContext, password: string): Promise<void> {
    const key = `unlock:${auth.userId}`;
    this.loginRateLimiter.assertAllowed(key, LOGIN_MAX_FAILURES);
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPassword(password, user.passwordHash))) {
      this.loginRateLimiter.recordFailure(key);
      throw new AppError("INVALID_CREDENTIALS", "密码错误", 401);
    }
    this.loginRateLimiter.recordSuccess(key);
  }

  async authenticateSessionRequest(request: RequestWithAuth): Promise<SessionAuthContext> {
    const token = this.extractSessionToken(request);
    if (!token) {
      throw new AppError("UNAUTHENTICATED", "请先登录", 401);
    }

    const tokenHash = hashOpaqueToken(token);
    const session = await this.prisma.client.session.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new AppError("SESSION_INVALID", "登录已失效", 401);
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: session.userId } });
    if (!user || user.disabledAt) {
      throw new AppError("SESSION_INVALID", "登录已失效", 401);
    }

    // lastSeenAt 只是活跃标记，按分钟级节流，避免每个请求都写一次 session 表。
    if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }

    return { kind: "session", userId: user.id, sessionId: session.id, isAdmin: user.isAdmin };
  }

  async getRegistrationSetting(): Promise<{ registrationEnabled: boolean }> {
    const settings = await this.prisma.client.appSetting.findUnique({ where: { id: 1 } });
    return { registrationEnabled: settings?.registrationEnabled ?? true };
  }

  // 登录/注册页（未登录）使用的公开状态：无用户时始终允许注册，且该用户将成为管理员。
  async getPublicRegistrationStatus(): Promise<{ registrationEnabled: boolean; willBeAdmin: boolean }> {
    const userCount = await this.prisma.client.user.count();
    if (userCount === 0) return { registrationEnabled: true, willBeAdmin: true };
    const { registrationEnabled } = await this.getRegistrationSetting();
    return { registrationEnabled, willBeAdmin: false };
  }

  async updateRegistrationSetting(enabled: boolean, admin: SessionAuthContext): Promise<{ registrationEnabled: boolean }> {
    const settings = await this.prisma.client.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, registrationEnabled: enabled, updatedBy: admin.userId },
      update: { registrationEnabled: enabled, updatedBy: admin.userId },
    });
    return { registrationEnabled: settings.registrationEnabled };
  }

  async listUsers(params: {
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminUser[]; nextOffset: number | null }> {
    const search = params.search?.trim();
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            // account / email 是 citext，contains 天然大小写不敏感；alias 为普通文本需显式 insensitive。
            { account: { contains: search } },
            { email: { contains: search } },
            { alias: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};
    const items = await this.prisma.client.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: params.offset,
      take: params.limit,
    });
    const nextOffset = items.length === params.limit ? params.offset + params.limit : null;
    return { items: items.map((user) => this.toAdminUser(user)), nextOffset };
  }

  async setUserDisabled(targetUserId: string, disabled: boolean, admin: SessionAuthContext): Promise<AdminUser> {
    if (targetUserId === admin.userId) {
      throw new AppError("CANNOT_DISABLE_SELF", "不能禁用自己的账号", 400);
    }
    return this.txs.run(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { disabledAt: disabled ? new Date() : null },
      });
      if (disabled) {
        // 禁用后立即吊销该用户所有有效会话，使其下次请求即失效。
        await tx.session.updateMany({
          where: { userId: targetUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.write(
        {
          source: "user",
          actorUserId: admin.userId,
          action: disabled ? "admin.user.disable" : "admin.user.enable",
          entityType: "user",
          entityId: targetUserId,
        },
        tx,
      );
      return this.toAdminUser(updated);
    });
  }

  async setUserAdmin(targetUserId: string, isAdmin: boolean, admin: SessionAuthContext): Promise<AdminUser> {
    return this.txs.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(931733002)`;
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
      }
      if (!isAdmin && target.isAdmin) {
        // 不能取消最后一个管理员，避免系统失去管理入口。
        const adminCount = await tx.user.count({ where: { isAdmin: true } });
        if (adminCount <= 1) {
          throw new AppError("LAST_ADMIN", "至少需要保留一个管理员", 400);
        }
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { isAdmin },
      });
      await this.audit.write(
        {
          source: "user",
          actorUserId: admin.userId,
          action: isAdmin ? "admin.user.grant_admin" : "admin.user.revoke_admin",
          entityType: "user",
          entityId: targetUserId,
        },
        tx,
      );
      return this.toAdminUser(updated);
    });
  }

  private toAdminUser(user: Prisma.UserGetPayload<object>): AdminUser {
    return {
      id: user.id,
      email: user.email,
      account: user.account,
      alias: user.alias,
      isAdmin: user.isAdmin,
      disabledAt: user.disabledAt,
      createdAt: user.createdAt,
    };
  }

  private async createSessionForUser(
    user: Prisma.UserGetPayload<object>,
    deviceName: string | undefined,
    request: RequestWithAuth,
    tx: Prisma.TransactionClient = this.prisma.client,
  ): Promise<AuthResult> {
    const token = createOpaqueToken("fn_sess");
    const expiresAt = addDays(new Date(), SESSION_TTL_DAYS);
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(token),
        deviceName,
        userAgent: this.getHeader(request, "user-agent"),
        ip: this.requestIp(request),
        expiresAt,
      },
    });
    return { user: this.toPublicUser(user), token, expiresAt };
  }

  private readonly config = loadConfig();

  private requestIp(request: RequestWithAuth): string | null {
    return clientIpFromRequest(request, this.config.TRUST_PROXY);
  }

  // 会话凭证只从 Authorization 头读取，不再支持 cookie。
  private extractSessionToken(request: RequestWithAuth): string | null {
    const authorization = this.getHeader(request, "authorization");
    if (authorization?.startsWith("Bearer fn_sess_")) {
      return authorization.slice("Bearer ".length);
    }
    return null;
  }

  private getHeader(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private toPublicUser(user: Prisma.UserGetPayload<object>): PublicUser {
    return {
      id: user.id,
      email: user.email,
      account: user.account,
      alias: user.alias,
      isAdmin: user.isAdmin,
    };
  }
}
