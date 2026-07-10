import { Injectable } from "@nestjs/common";
import { AppError, AuditLogService, PrismaService } from "@fin-nest/backend";
import { RequestWithAuth, ServiceAuthContext, SessionAuthContext } from "./auth.types";
import { CreateServiceTokenDto } from "./dto/create-service-token.dto";
import { loadConfig } from "@fin-nest/config";
import { createOpaqueToken, hashOpaqueToken } from "./token-utils";
import { clientIpFromRequest, ipMatchesAllowedCidrs } from "./ip-utils";

export type ServiceTokenSummary = {
  id: string;
  name: string;
  scopes: string[];
  allowedIps: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

type ServiceTokenRecord = ServiceTokenSummary & {
  tokenHash: string;
};

export type CreatedServiceToken = ServiceTokenSummary & {
  token: string;
};

@Injectable()
export class ServiceTokenService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateServiceTokenDto, admin: SessionAuthContext): Promise<CreatedServiceToken> {
    const token = createOpaqueToken("fn_svc");
    const tokenHash = hashOpaqueToken(token);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new AppError("INVALID_EXPIRES_AT", "过期时间格式不正确", 400);
    }

    const [row] = await this.prisma.client.$queryRaw<ServiceTokenSummary[]>`
      INSERT INTO service_tokens (name, token_hash, scopes, allowed_ips, expires_at, created_by)
      VALUES (
        ${input.name},
        ${tokenHash},
        ${input.scopes}::text[],
        ${input.allowedIps ?? []}::cidr[],
        ${expiresAt},
        ${admin.userId}::uuid
      )
      RETURNING id, name, scopes, allowed_ips::text[] AS "allowedIps", expires_at AS "expiresAt",
                revoked_at AS "revokedAt", last_used_at AS "lastUsedAt", created_at AS "createdAt"
    `;
    if (!row) throw new AppError("SERVICE_TOKEN_CREATE_FAILED", "创建 service token 失败", 500);

    await this.audit.write({
      source: "user",
      actorUserId: admin.userId,
      action: "service_token.create",
      entityType: "service_token",
      entityId: row.id,
      metadata: { scopes: row.scopes },
    });

    return { ...row, token };
  }

  async list(): Promise<ServiceTokenSummary[]> {
    return this.prisma.client.$queryRaw<ServiceTokenSummary[]>`
      SELECT id, name, scopes, allowed_ips::text[] AS "allowedIps", expires_at AS "expiresAt",
             revoked_at AS "revokedAt", last_used_at AS "lastUsedAt", created_at AS "createdAt"
        FROM service_tokens
       ORDER BY created_at DESC
    `;
  }

  async revoke(id: string, admin: SessionAuthContext): Promise<void> {
    await this.prisma.client.serviceToken.updateMany({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.write({
      source: "user",
      actorUserId: admin.userId,
      action: "service_token.revoke",
      entityType: "service_token",
      entityId: id,
    });
  }

  async authenticate(
    request: RequestWithAuth,
    requiredScope: string,
    actorUserId?: string,
    ledgerId?: string,
  ): Promise<ServiceAuthContext> {
    const token = this.extractServiceToken(request);
    if (!token) throw new AppError("SERVICE_TOKEN_REQUIRED", "缺少 service token", 401);

    const [serviceToken] = await this.prisma.client.$queryRaw<ServiceTokenRecord[]>`
      SELECT id, name, token_hash AS "tokenHash", scopes, allowed_ips::text[] AS "allowedIps",
             expires_at AS "expiresAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt",
             created_at AS "createdAt"
        FROM service_tokens
       WHERE token_hash = ${hashOpaqueToken(token)}
       LIMIT 1
    `;
    const now = new Date();
    if (!serviceToken || serviceToken.revokedAt || (serviceToken.expiresAt && serviceToken.expiresAt <= now)) {
      throw new AppError("SERVICE_TOKEN_INVALID", "service token 无效", 401);
    }
    if (!serviceToken.scopes.includes(requiredScope)) {
      throw new AppError("SERVICE_TOKEN_SCOPE_DENIED", "service token scope 不足", 403);
    }

    // 代理后 socket 地址是代理 IP，白名单需要按真实客户端 IP 匹配（TRUST_PROXY 控制是否信 XFF）。
    const ip = clientIpFromRequest(request, this.config.TRUST_PROXY);
    if (!ipMatchesAllowedCidrs(ip, serviceToken.allowedIps)) {
      throw new AppError("SERVICE_TOKEN_IP_DENIED", "来源 IP 不允许", 403);
    }

    if (actorUserId && ledgerId) {
      await this.assertActorCanAccessLedger(actorUserId, ledgerId);
    }

    await this.prisma.client.serviceToken.update({
      where: { id: serviceToken.id },
      data: { lastUsedAt: now },
    });

    await this.audit.write({
      source: "service",
      serviceTokenId: serviceToken.id,
      actorUserId: actorUserId ?? null,
      ledgerId: ledgerId ?? null,
      action: "service_token.authenticate",
      entityType: "service_token",
      entityId: serviceToken.id,
      metadata: { requiredScope },
    });

    return {
      kind: "service",
      serviceTokenId: serviceToken.id,
      scopes: serviceToken.scopes,
      actorUserId,
      ledgerId,
    };
  }

  private async assertActorCanAccessLedger(actorUserId: string, ledgerId: string): Promise<void> {
    const actor = await this.prisma.client.user.findUnique({ where: { id: actorUserId } });
    if (!actor || actor.disabledAt) {
      throw new AppError("SERVICE_ACTOR_INVALID", "代表用户不存在或已禁用", 403);
    }
    const membership = await this.prisma.client.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId: actorUserId } },
    });
    if (!membership || membership.removedAt) {
      throw new AppError("SERVICE_ACTOR_LEDGER_DENIED", "代表用户无账本权限", 403);
    }
  }

  private extractServiceToken(request: RequestWithAuth): string | null {
    const authorization = request.headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value?.startsWith("Bearer fn_svc_")) return null;
    return value.slice("Bearer ".length);
  }
}
