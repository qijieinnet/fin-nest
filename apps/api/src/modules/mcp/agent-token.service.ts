import { isIP } from "node:net";
import { Injectable } from "@nestjs/common";
import { AppError, AuditLogService, PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import type { AgentToken } from "@fin-nest/db";
import { clientIpFromRequest, ipMatchesAllowedCidrs } from "../auth/ip-utils";
import { createOpaqueToken, hashOpaqueToken } from "../auth/token-utils";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  AGENT_TOKEN_CALLS_PER_MINUTE,
  AGENT_TOKEN_TOUCH_INTERVAL_MS,
  AGENT_TOKEN_WRITES_PER_MINUTE,
  MAX_ACTIVE_AGENT_TOKENS,
} from "./agent-token.constants";
import { CreateAgentTokenDto, UpdateAgentTokenDto } from "./dto/agent-token.dto";

const TOKEN_PREFIX = "fn_pat_";

/** MCP 请求的身份：userId 只来自 token 归属，调用方无法声明「代表谁」。 */
export type AgentAuthContext = {
  tokenId: string;
  tokenName: string;
  userId: string;
  /** 空数组 = 该用户所在的全部账本。 */
  ledgerIds: string[];
  scopes: string[];
};

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

export type AgentTokenSummary = {
  id: string;
  name: string;
  tokenSuffix: string;
  ledgerIds: string[];
  scopes: string[];
  allowedIps: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
};

@Injectable()
export class AgentTokenService {
  private readonly config = loadConfig();
  /** tokenId → 当前分钟窗口内的调用次数。 */
  private readonly callWindows = new Map<string, { windowStart: number; count: number }>();
  private readonly writeWindows = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
  ) {}

  async list(userId: string): Promise<AgentTokenSummary[]> {
    const rows = await this.prisma.client.agentToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async create(
    userId: string,
    input: CreateAgentTokenDto,
  ): Promise<AgentTokenSummary & { token: string }> {
    const ledgerIds = input.ledgerIds ?? [];
    assertScopes(input.scopes);
    await this.assertLedgersAccessible(userId, ledgerIds);
    const allowedIps = normalizeCidrs(input.allowedIps ?? []);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppError("AGENT_TOKEN_EXPIRES_IN_PAST", "过期时间必须晚于现在", 400);
    }
    const now = new Date();
    const active = await this.prisma.client.agentToken.count({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (active >= MAX_ACTIVE_AGENT_TOKENS) {
      throw new AppError(
        "AGENT_TOKEN_LIMIT",
        `最多同时保留 ${MAX_ACTIVE_AGENT_TOKENS} 个有效 token，请先吊销不用的`,
        400,
      );
    }

    const token = createOpaqueToken("fn_pat");
    const row = await this.prisma.client.agentToken.create({
      data: {
        userId,
        name: input.name.trim(),
        tokenHash: hashOpaqueToken(token),
        tokenSuffix: token.slice(-4),
        ledgerIds,
        scopes: input.scopes,
        allowedIps,
        expiresAt,
      },
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      action: "agent_token.create",
      entityType: "agent_token",
      entityId: row.id,
      metadata: { scopes: row.scopes, ledgerIds: row.ledgerIds },
    });
    return { ...toSummary(row), token };
  }

  async update(
    userId: string,
    tokenId: string,
    input: UpdateAgentTokenDto,
  ): Promise<AgentTokenSummary> {
    const existing = await this.findOwned(userId, tokenId);
    if (existing.revokedAt) {
      throw new AppError("AGENT_TOKEN_REVOKED", "token 已吊销，无法修改", 409);
    }
    if (input.scopes) assertScopes(input.scopes);
    if (input.ledgerIds) await this.assertLedgersAccessible(userId, input.ledgerIds);
    const row = await this.prisma.client.agentToken.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.ledgerIds !== undefined ? { ledgerIds: input.ledgerIds } : {}),
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
      },
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      action: "agent_token.update",
      entityType: "agent_token",
      entityId: row.id,
      metadata: { scopes: row.scopes, ledgerIds: row.ledgerIds },
    });
    return toSummary(row);
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const existing = await this.findOwned(userId, tokenId);
    if (existing.revokedAt) return;
    await this.prisma.client.agentToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      action: "agent_token.revoke",
      entityType: "agent_token",
      entityId: existing.id,
    });
  }

  /**
   * 校验 `Authorization: Bearer fn_pat_*`：每次请求都重新判定吊销、过期、来源 IP 与用户是否被禁用，
   * 账本成员身份留给各领域 service 的 assertMember（用户退出账本即自动失效）。
   */
  async authenticate(request: RequestLike): Promise<AgentAuthContext> {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
      throw new AppError("AGENT_TOKEN_REQUIRED", "缺少智能体 token", 401);
    }
    const token = value.slice("Bearer ".length).trim();
    const row = await this.prisma.client.agentToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
    });
    const now = new Date();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) {
      throw new AppError("AGENT_TOKEN_INVALID", "智能体 token 无效或已过期", 401);
    }
    const user = await this.prisma.client.user.findUnique({
      where: { id: row.userId },
      select: { disabledAt: true },
    });
    if (!user || user.disabledAt) {
      throw new AppError("AGENT_TOKEN_INVALID", "智能体 token 无效或已过期", 401);
    }
    const ip = clientIpFromRequest(request, this.config.TRUST_PROXY);
    if (!ipMatchesAllowedCidrs(ip, row.allowedIps)) {
      throw new AppError("AGENT_TOKEN_IP_DENIED", "来源 IP 不在该 token 的白名单内", 403);
    }
    this.checkRateLimit(row.id, now.getTime());

    if (
      !row.lastUsedAt ||
      now.getTime() - row.lastUsedAt.getTime() > AGENT_TOKEN_TOUCH_INTERVAL_MS
    ) {
      await this.prisma.client.agentToken.update({
        where: { id: row.id },
        data: { lastUsedAt: now, lastUsedIp: ip },
      });
    }

    return {
      tokenId: row.id,
      tokenName: row.name,
      userId: row.userId,
      ledgerIds: row.ledgerIds,
      scopes: row.scopes,
    };
  }

  /** 写工具另有更紧的上限：智能体失控循环写入时，读还能用、写先被拦住。 */
  checkWriteRate(tokenId: string, nowMs = Date.now()): void {
    const window = this.writeWindows.get(tokenId);
    if (!window || nowMs - window.windowStart >= 60_000) {
      this.writeWindows.set(tokenId, { windowStart: nowMs, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > AGENT_TOKEN_WRITES_PER_MINUTE) {
      throw new AppError("AGENT_TOKEN_WRITE_RATE_LIMITED", "写入过于频繁，请稍后再试", 429);
    }
  }

  private checkRateLimit(tokenId: string, nowMs: number): void {
    const window = this.callWindows.get(tokenId);
    if (!window || nowMs - window.windowStart >= 60_000) {
      this.callWindows.set(tokenId, { windowStart: nowMs, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > AGENT_TOKEN_CALLS_PER_MINUTE) {
      throw new AppError("AGENT_TOKEN_RATE_LIMITED", "调用过于频繁，请稍后再试", 429);
    }
  }

  private async findOwned(userId: string, tokenId: string): Promise<AgentToken> {
    const row = await this.prisma.client.agentToken.findFirst({ where: { id: tokenId, userId } });
    if (!row) throw new AppError("AGENT_TOKEN_NOT_FOUND", "token 不存在", 404);
    return row;
  }

  private async assertLedgersAccessible(userId: string, ledgerIds: string[]): Promise<void> {
    for (const ledgerId of ledgerIds) await this.ledgers.assertMember(ledgerId, userId);
  }
}

/** 写工具要先靠只读工具拿到 id，没有 read 的 token 什么也做不成。 */
function assertScopes(scopes: string[]): void {
  if (!scopes.includes("read")) {
    throw new AppError("AGENT_TOKEN_READ_REQUIRED", "权限必须包含只读（read）", 400);
  }
}

function toSummary(row: AgentToken): AgentTokenSummary {
  return {
    id: row.id,
    name: row.name,
    tokenSuffix: row.tokenSuffix,
    ledgerIds: row.ledgerIds,
    scopes: row.scopes,
    allowedIps: row.allowedIps,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt,
  };
}

/** 白名单项只认 IPv4/IPv6 地址或「地址/前缀」，写入前统一校验，免得一条错项让 token 永远连不上。 */
function normalizeCidrs(values: string[]): string[] {
  return values.map((raw) => {
    const value = raw.trim();
    const [address, prefixText, extra] = value.split("/");
    const family = address ? isIP(address) : 0;
    const prefix = prefixText === undefined ? null : Number(prefixText);
    const maxPrefix = family === 6 ? 128 : 32;
    if (
      family === 0 ||
      extra !== undefined ||
      (prefix !== null && (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix))
    ) {
      throw new AppError("AGENT_TOKEN_INVALID_IP", `IP 白名单格式不正确：${value}`, 400);
    }
    return value;
  });
}
