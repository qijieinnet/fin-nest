import { Injectable } from "@nestjs/common";
import { AppError, AuditLogService, DatabaseTransactionService, PrismaService } from "@fin-nest/backend";
import { CreateLedgerDto } from "./dto/create-ledger.dto";
import { UpdateLedgerDto } from "./dto/update-ledger.dto";
import { CreateInviteDto } from "./dto/create-invite.dto";
import { CreateJoinRequestDto } from "./dto/create-join-request.dto";
import { createInviteCode, hashInviteCode } from "./invite-code";
import { initializeLedgerDefaults } from "./ledger-defaults";

type LedgerRole = "owner" | "member";

@Injectable()
export class LedgersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.client.ledgerMember.findMany({
      where: { userId, removedAt: null },
      select: { ledgerId: true },
    });
    if (memberships.length === 0) return [];
    return this.prisma.client.ledger.findMany({
      where: {
        id: { in: memberships.map((membership) => membership.ledgerId) },
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async get(ledgerId: string, userId: string) {
    await this.assertMember(ledgerId, userId);
    return this.prisma.client.ledger.findFirstOrThrow({ where: { id: ledgerId, deletedAt: null } });
  }

  async create(input: CreateLedgerDto, userId: string) {
    return this.txs.run(async (tx) => {
      const ledger = await tx.ledger.create({
        data: {
          name: input.name,
          icon: input.icon,
          currency: input.currency ?? "CNY",
          ownerUserId: userId,
          createdBy: userId,
        },
      });
      await tx.ledgerMember.create({
        data: { ledgerId: ledger.id, userId, role: "owner" },
      });
      await initializeLedgerDefaults(tx, ledger.id, userId);
      await this.audit.write(
        {
          source: "user",
          actorUserId: userId,
          ledgerId: ledger.id,
          action: "ledger.create",
          entityType: "ledger",
          entityId: ledger.id,
        },
        tx,
      );
      return ledger;
    }, { timeout: 20000 });
  }

  async update(ledgerId: string, userId: string, input: UpdateLedgerDto) {
    await this.assertOwner(ledgerId, userId);
    return this.prisma.client.ledger.update({
      where: { id: ledgerId },
      data: {
        name: input.name,
        icon: input.icon,
        currency: input.currency,
        updatedBy: userId,
      },
    });
  }

  async delete(ledgerId: string, userId: string): Promise<void> {
    await this.assertOwner(ledgerId, userId);
    await this.txs.run(async (tx) => {
      await tx.ledger.update({
        where: { id: ledgerId },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
      await this.audit.write(
        {
          source: "user",
          actorUserId: userId,
          ledgerId,
          action: "ledger.delete",
          entityType: "ledger",
          entityId: ledgerId,
        },
        tx,
      );
    });
  }

  async listMembers(ledgerId: string, userId: string) {
    await this.assertMember(ledgerId, userId);
    const members = await this.prisma.client.ledgerMember.findMany({
      where: { ledgerId, removedAt: null },
      orderBy: { joinedAt: "asc" },
    });
    const identities = await this.loadUserIdentities(members.map((member) => member.userId));
    return members.map((member) => {
      const identity = identities.get(member.userId);
      return { ...member, alias: identity?.alias ?? "", account: identity?.account ?? "" };
    });
  }

  async removeMember(ledgerId: string, targetUserId: string, actorUserId: string): Promise<void> {
    await this.assertOwner(ledgerId, actorUserId);
    const membership = await this.prisma.client.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
    });
    if (!membership || membership.removedAt) {
      throw new AppError("LEDGER_MEMBER_NOT_FOUND", "成员不存在", 404);
    }
    if (membership.role === "owner") {
      throw new AppError("OWNER_CANNOT_BE_REMOVED", "不能移除账本所有者", 400);
    }
    await this.prisma.client.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      data: { removedAt: new Date() },
    });
  }

  async createInvite(ledgerId: string, actorUserId: string, input: CreateInviteDto) {
    await this.assertOwner(ledgerId, actorUserId);
    const code = createInviteCode();
    const invite = await this.prisma.client.ledgerInvite.create({
      data: {
        ledgerId,
        codeHash: hashInviteCode(code),
        createdBy: actorUserId,
        expiresAt: new Date(Date.now() + (input.expiresInDays ?? 1) * 24 * 60 * 60 * 1000),
      },
    });
    return { ...invite, code };
  }

  async revokeInvite(ledgerId: string, inviteId: string, actorUserId: string): Promise<void> {
    await this.assertOwner(ledgerId, actorUserId);
    const invite = await this.prisma.client.ledgerInvite.findFirst({ where: { id: inviteId, ledgerId } });
    if (!invite) throw new AppError("INVITE_NOT_FOUND", "邀请不存在", 404);
    await this.prisma.client.ledgerInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  async createJoinRequest(userId: string, input: CreateJoinRequestDto) {
    const invite = await this.prisma.client.ledgerInvite.findUnique({
      where: { codeHash: hashInviteCode(input.inviteCode) },
    });
    if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) {
      throw new AppError("INVITE_INVALID", "邀请码无效或已过期", 404);
    }
    const membership = await this.prisma.client.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId: invite.ledgerId, userId } },
    });
    if (membership && !membership.removedAt) {
      throw new AppError("ALREADY_LEDGER_MEMBER", "已经是账本成员", 400);
    }

    const pending = await this.prisma.client.ledgerJoinRequest.findFirst({
      where: { ledgerId: invite.ledgerId, requesterUserId: userId, status: "pending" },
    });
    if (pending) {
      throw new AppError("JOIN_REQUEST_PENDING", "已有待处理的加入申请", 400);
    }

    return this.txs.run(async (tx) => {
      const request = await tx.ledgerJoinRequest.create({
        data: {
          ledgerId: invite.ledgerId,
          inviteId: invite.id,
          requesterUserId: userId,
          status: "pending",
          message: input.message,
        },
      });
      await tx.ledgerInvite.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      });
      return request;
    });
  }

  async listJoinRequests(ledgerId: string, actorUserId: string, status = "pending") {
    await this.assertOwner(ledgerId, actorUserId);
    const requests = await this.prisma.client.ledgerJoinRequest.findMany({
      where: { ledgerId, status },
      orderBy: { createdAt: "asc" },
    });
    const identities = await this.loadUserIdentities(
      requests.map((request) => request.requesterUserId),
    );
    return requests.map((request) => {
      const identity = identities.get(request.requesterUserId);
      return {
        ...request,
        requesterAlias: identity?.alias ?? "",
        requesterAccount: identity?.account ?? "",
      };
    });
  }

  async approveJoinRequest(ledgerId: string, requestId: string, actorUserId: string) {
    await this.assertOwner(ledgerId, actorUserId);
    return this.reviewJoinRequest(ledgerId, requestId, actorUserId, "approved");
  }

  async rejectJoinRequest(ledgerId: string, requestId: string, actorUserId: string) {
    await this.assertOwner(ledgerId, actorUserId);
    return this.reviewJoinRequest(ledgerId, requestId, actorUserId, "rejected");
  }

  async cancelJoinRequest(requestId: string, userId: string) {
    const request = await this.prisma.client.ledgerJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.requesterUserId !== userId || request.status !== "pending") {
      throw new AppError("JOIN_REQUEST_NOT_FOUND", "加入申请不存在", 404);
    }
    return this.prisma.client.ledgerJoinRequest.update({
      where: { id: requestId },
      data: { status: "cancelled" },
    });
  }

  /** 批量取用户身份（仅 alias/account，不暴露 email 等敏感字段）。 */
  private async loadUserIdentities(userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map<string, { alias: string; account: string }>();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, alias: true, account: true },
    });
    return new Map(users.map((user) => [user.id, { alias: user.alias, account: user.account }]));
  }

  async assertMember(ledgerId: string, userId: string): Promise<LedgerRole> {
    const membership = await this.prisma.client.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!membership || membership.removedAt) {
      throw new AppError("LEDGER_ACCESS_DENIED", "无账本访问权限", 403);
    }
    // 账本软删除后所有子资源接口都应失效，而不是仅从列表消失。
    const ledger = await this.prisma.client.ledger.findFirst({
      where: { id: ledgerId, deletedAt: null },
      select: { id: true },
    });
    if (!ledger) {
      throw new AppError("LEDGER_NOT_FOUND", "账本不存在", 404);
    }
    return membership.role as LedgerRole;
  }

  async assertOwner(ledgerId: string, userId: string): Promise<void> {
    const role = await this.assertMember(ledgerId, userId);
    if (role !== "owner") {
      throw new AppError("LEDGER_OWNER_REQUIRED", "需要账本所有者权限", 403);
    }
  }

  private async reviewJoinRequest(
    ledgerId: string,
    requestId: string,
    actorUserId: string,
    status: "approved" | "rejected",
  ) {
    return this.txs.run(async (tx) => {
      const request = await tx.ledgerJoinRequest.findFirst({
        where: { id: requestId, ledgerId, status: "pending" },
      });
      if (!request) {
        throw new AppError("JOIN_REQUEST_NOT_FOUND", "加入申请不存在", 404);
      }

      if (status === "approved") {
        await tx.ledgerMember.upsert({
          where: { ledgerId_userId: { ledgerId, userId: request.requesterUserId } },
          create: { ledgerId, userId: request.requesterUserId, role: "member" },
          update: { role: "member", removedAt: null },
        });
      }

      const reviewed = await tx.ledgerJoinRequest.update({
        where: { id: requestId },
        data: { status, reviewedBy: actorUserId, reviewedAt: new Date() },
      });

      await this.audit.write(
        {
          source: "user",
          actorUserId,
          ledgerId,
          action: `ledger_join_request.${status}`,
          entityType: "ledger_join_request",
          entityId: requestId,
        },
        tx,
      );
      return reviewed;
    });
  }
}
