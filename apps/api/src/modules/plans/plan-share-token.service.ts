import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  parseDateOnly,
  PrismaService,
  todayKey,
} from "@fin-nest/backend";
import { createOpaqueToken, hashOpaqueToken } from "../auth/token-utils";
import { LedgersService } from "../ledgers/ledgers.service";
import { PlansService } from "./plans.service";

export type PlanShareTokenSummary = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

@Injectable()
export class PlanShareTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly txs: DatabaseTransactionService,
    private readonly ledgers: LedgersService,
    private readonly plans: PlansService,
  ) {}

  /** 生成计划分享 token（明文仅返回一次）。同一计划旧的有效 token 会被吊销（轮换）。 */
  async create(
    ledgerId: string,
    planId: string,
    userId: string,
  ): Promise<PlanShareTokenSummary & { token: string }> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);

    const token = createOpaqueToken("fn_plan");
    const tokenHash = hashOpaqueToken(token);

    const created = await this.txs.run(async (tx) => {
      await tx.planShareToken.updateMany({
        where: { planId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.planShareToken.create({
        data: { planId, ledgerId, tokenHash, createdBy: userId },
        select: { id: true, createdAt: true, lastUsedAt: true },
      });
    });

    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "plan_share_token.create",
      entityType: "plan_share_token",
      entityId: created.id,
      metadata: { planId },
    });

    return { ...created, token };
  }

  /** 返回该计划当前有效的分享 token 元数据（不含明文），无则返回 null。 */
  async getActive(
    ledgerId: string,
    planId: string,
    userId: string,
  ): Promise<PlanShareTokenSummary | null> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    return this.prisma.client.planShareToken.findFirst({
      where: { planId, ledgerId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, lastUsedAt: true },
    });
  }

  /** 吊销该计划所有有效分享 token。 */
  async revoke(ledgerId: string, planId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    await this.prisma.client.planShareToken.updateMany({
      where: { planId, ledgerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "plan_share_token.revoke",
      entityType: "plan_share_token",
      entityId: planId,
      metadata: { planId },
    });
  }

  /** 免登录读取：凭明文 token 定位计划并返回「本期」卡片数据。 */
  async readCard(token: string) {
    if (!token.startsWith("fn_plan_"))
      throw new AppError("PLAN_SHARE_TOKEN_INVALID", "分享链接无效", 404);
    const record = await this.prisma.client.planShareToken.findFirst({
      where: { tokenHash: hashOpaqueToken(token), revokedAt: null },
      select: { id: true, planId: true },
    });
    if (!record) throw new AppError("PLAN_SHARE_TOKEN_INVALID", "分享链接无效或已失效", 404);
    const plan = await this.prisma.client.plan.findFirst({
      where: { id: record.planId, archivedAt: null, stoppedAt: null },
    });
    if (!plan) throw new AppError("PLAN_SHARE_TOKEN_INVALID", "分享链接无效或已失效", 404);
    const card = await this.plans.computeCurrentPeriodCard(plan, parseDateOnly(todayKey()));
    await this.prisma.client.planShareToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return card;
  }

  private async assertPlan(ledgerId: string, planId: string) {
    const plan = await this.prisma.client.plan.findFirst({
      where: { id: planId, ledgerId, archivedAt: null },
    });
    if (!plan) throw new AppError("PLAN_NOT_FOUND", "计划不存在", 404);
    return plan;
  }
}
