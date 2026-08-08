import { Injectable } from "@nestjs/common";
import { AppError, AuditLogService, DatabaseTransactionService, PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { SessionAuthContext } from "./auth.types";

export type AppLockStatus = {
  /** 账号级开关：开启后该用户在任何设备打开应用都要先验证身份。 */
  enabled: boolean;
  /** 飞书客户端内跳过上面那道验证（默认开启）；`enabled` 为假时无意义。 */
  skipInFeishu: boolean;
  /** 已注册的 Face ID / Touch ID 凭证数量，0 表示所有设备都只能用密码解锁。 */
  credentialCount: number;
};

const RP_NAME = "Fin Nest";
const WEBAUTHN_TIMEOUT_MS = 60_000;

// challenge 只在「下发 options → 提交断言」这一次往返中有效，属于纯瞬时状态，
// 存内存即可（进程重启最多让正在进行的那一次验证失败，用户重试一次即可）。
// 与 AuthService 的登录限速器同样是单实例自部署前提；多实例部署需换成共享存储。
const CHALLENGE_TTL_MS = 120_000;

type ChallengePurpose = "register" | "unlock";

class ChallengeStore {
  private readonly entries = new Map<string, { challenge: string; expiresAt: number }>();

  save(key: string, challenge: string): void {
    this.prune();
    this.entries.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  /** 一次性取用：无论验证成功与否都不能复用，避免同一 challenge 被重放。 */
  take(key: string): string {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      throw new AppError("APP_LOCK_CHALLENGE_EXPIRED", "验证已超时，请重试", 400);
    }
    return entry.challenge;
  }

  private prune(): void {
    if (this.entries.size < 500) return;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

/**
 * 应用锁（打开应用时验证身份）：开关与 WebAuthn 凭证都存数据库，解锁走服务端验签。
 *
 * 与旧版纯客户端实现的区别：换浏览器/新设备登录后开关和凭证自动恢复，不需要重新设置；
 * 代价是解锁必须能连到 API（离线时 Face ID 与密码两条路都走不通）。
 */
@Injectable()
export class AppLockService {
  private readonly config = loadConfig();
  private readonly challenges = new ChallengeStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
  ) {}

  async getStatus(auth: SessionAuthContext): Promise<AppLockStatus> {
    const [user, credentialCount] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      this.prisma.client.appLockCredential.count({ where: { userId: auth.userId } }),
    ]);
    return {
      enabled: user.appLockEnabled,
      skipInFeishu: user.appLockSkipInFeishu,
      credentialCount,
    };
  }

  /**
   * 开关应用锁。关闭时一并清掉已注册凭证：重新开启会重新注册，
   * 留着只会在系统钥匙串里堆孤儿 passkey。
   *
   * `skipInFeishu` 单独可改（不传即保持不变），因为它是总开关下的子选项：
   * 用户在设置页拨的是两个独立开关，一个的写入不该顺手覆盖另一个。
   */
  async setEnabled(
    auth: SessionAuthContext,
    input: { enabled?: boolean; skipInFeishu?: boolean },
  ): Promise<AppLockStatus> {
    // 两个字段都没传就是空请求，直接读回现状——否则会写一次什么都没改的 update，白白推 updatedAt。
    if (input.enabled === undefined && input.skipInFeishu === undefined) {
      return this.getStatus(auth);
    }
    return this.txs.run(async (tx) => {
      const user = await tx.user.update({
        where: { id: auth.userId },
        data: {
          ...(input.enabled === undefined ? {} : { appLockEnabled: input.enabled }),
          ...(input.skipInFeishu === undefined ? {} : { appLockSkipInFeishu: input.skipInFeishu }),
        },
      });
      if (input.enabled === false) {
        await tx.appLockCredential.deleteMany({ where: { userId: auth.userId } });
      }
      if (input.enabled !== undefined) {
        await this.audit.write(
          {
            source: "user",
            actorUserId: auth.userId,
            action: input.enabled ? "auth.app_lock.enable" : "auth.app_lock.disable",
            entityType: "user",
            entityId: auth.userId,
          },
          tx,
        );
      }
      const credentialCount = user.appLockEnabled
        ? await tx.appLockCredential.count({ where: { userId: auth.userId } })
        : 0;
      return {
        enabled: user.appLockEnabled,
        skipInFeishu: user.appLockSkipInFeishu,
        credentialCount,
      };
    });
  }

  /** 下发注册 options（含 challenge），前端拿去调 navigator.credentials.create。 */
  async createRegistrationOptions(
    auth: SessionAuthContext,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const existing = await this.prisma.client.appLockCredential.findMany({
      where: { userId: auth.userId },
      select: { credentialId: true, transports: true },
    });
    const { rpID } = this.relyingParty();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.account,
      userDisplayName: user.alias,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      // 同一台设备重复注册没有意义，交给系统提示「已注册过」。
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        // 只要设备内置认证器（Face ID / Touch ID），不引导用户去插安全密钥。
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      // ES256 / RS256，覆盖 Apple 平台认证器支持的算法。
      supportedAlgorithmIDs: [-7, -257],
      timeout: WEBAUTHN_TIMEOUT_MS,
    });

    this.challenges.save(this.challengeKey(auth, "register"), options.challenge);
    return options;
  }

  /** 校验注册断言并落库；成功即视为用户完成了应用锁设置，顺带把开关打开。 */
  async confirmRegistration(
    auth: SessionAuthContext,
    response: RegistrationResponseJSON,
  ): Promise<AppLockStatus> {
    const expectedChallenge = this.challenges.take(this.challengeKey(auth, "register"));
    const { rpID, origins } = this.relyingParty();

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw new AppError("APP_LOCK_REGISTRATION_INVALID", "Face ID 注册验证失败", 400);
    }
    if (!verification.verified) {
      throw new AppError("APP_LOCK_REGISTRATION_INVALID", "Face ID 注册验证失败", 400);
    }

    const { credential } = verification.registrationInfo;
    const session = await this.prisma.client.session.findUnique({
      where: { id: auth.sessionId },
      select: { deviceName: true },
    });

    return this.txs.run(async (tx) => {
      // attestation 用 "none"，credentialId 完全由客户端提供，不能当作可信标识：
      // 若这把 ID 已属于别的用户，覆盖它等于把对方的凭证改绑到自己名下（对方 Face ID 直接失效），
      // 所以只允许「不存在」或「本来就是自己的」两种情况。
      const existing = await tx.appLockCredential.findUnique({
        where: { credentialId: credential.id },
        select: { id: true, userId: true },
      });
      if (existing && existing.userId !== auth.userId) {
        throw new AppError("APP_LOCK_CREDENTIAL_CONFLICT", "该凭证已被其它账号注册", 409);
      }

      const data = {
        publicKey: credential.publicKey,
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceName: session?.deviceName ?? null,
      };
      if (existing) {
        // 同一把凭证重新注册（例如用户清了数据又注册回来）时覆盖公钥与计数器。
        await tx.appLockCredential.update({ where: { id: existing.id }, data });
      } else {
        await tx.appLockCredential.create({
          data: { ...data, userId: auth.userId, credentialId: credential.id },
        });
      }
      await tx.user.update({ where: { id: auth.userId }, data: { appLockEnabled: true } });
      await this.audit.write(
        {
          source: "user",
          actorUserId: auth.userId,
          action: "auth.app_lock.register_credential",
          entityType: "user",
          entityId: auth.userId,
          metadata: { deviceName: session?.deviceName ?? null },
        },
        tx,
      );
      const credentialCount = await tx.appLockCredential.count({ where: { userId: auth.userId } });
      const { appLockSkipInFeishu } = await tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { appLockSkipInFeishu: true },
      });
      return { enabled: true, skipInFeishu: appLockSkipInFeishu, credentialCount };
    });
  }

  /**
   * 下发解锁 options：allowCredentials 带上该用户全部已注册凭证，
   * 由系统挑一把本机（含 iCloud 钥匙串同步过来的）能用的，因此换浏览器不必重新注册。
   * 返回空 allowCredentials 表示该账号还没有可用凭证，前端应直接走密码解锁。
   */
  async createUnlockOptions(
    auth: SessionAuthContext,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const credentials = await this.prisma.client.appLockCredential.findMany({
      where: { userId: auth.userId },
      select: { credentialId: true, transports: true },
      orderBy: { lastUsedAt: "desc" },
    });
    const { rpID } = this.relyingParty();

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: "required",
      timeout: WEBAUTHN_TIMEOUT_MS,
    });

    this.challenges.save(this.challengeKey(auth, "unlock"), options.challenge);
    return options;
  }

  /** 校验解锁断言。通过后只更新计数器与最近使用时间，不签发新 session（应用锁不是登录）。 */
  async verifyUnlock(auth: SessionAuthContext, response: AuthenticationResponseJSON): Promise<void> {
    const expectedChallenge = this.challenges.take(this.challengeKey(auth, "unlock"));
    const stored = await this.prisma.client.appLockCredential.findUnique({
      where: { credentialId: response.id },
    });
    // 凭证必须属于当前登录用户：否则拿别人的 credentialId 也能解开自己的锁。
    if (!stored || stored.userId !== auth.userId) {
      throw new AppError("APP_LOCK_CREDENTIAL_NOT_FOUND", "该设备未注册应用锁凭证", 404);
    }

    const { rpID, origins } = this.relyingParty();
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch {
      throw new AppError("APP_LOCK_UNLOCK_INVALID", "验证失败，请重试", 401);
    }
    if (!verification.verified) {
      throw new AppError("APP_LOCK_UNLOCK_INVALID", "验证失败，请重试", 401);
    }

    await this.prisma.client.appLockCredential.update({
      where: { id: stored.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
  }

  private challengeKey(auth: SessionAuthContext, purpose: ChallengePurpose): string {
    return `${auth.sessionId}:${purpose}`;
  }

  /**
   * WebAuthn 的 RP ID 与允许的来源。RP ID 必须与浏览器访问的域名一致且前后两次相同，
   * 所以默认取 WEB_ORIGIN 第一项的 hostname，多域名部署用 APP_LOCK_RP_ID 显式钉死。
   */
  private relyingParty(): { rpID: string; origins: string[] } {
    const origins = this.config.WEB_ORIGIN;
    if (origins.length === 0) {
      throw new AppError("APP_LOCK_NOT_CONFIGURED", "服务端未配置 WEB_ORIGIN，无法启用 Face ID 解锁", 500);
    }
    const rpID = this.config.APP_LOCK_RP_ID ?? new URL(origins[0]!).hostname;
    return { rpID, origins };
  }
}
