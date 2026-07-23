import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { AppError } from "../errors/app-error";
import { PrismaService } from "../prisma/prisma.service";
import { ReminderTargetSourceType } from "./notifications.types";

/** 响应体里的飞书推送目标：够前端渲染选中项即可，不含账本信息。 */
export type ReminderTargetSummary = {
  id: string;
  displayName: string | null;
  openIdSuffix: string;
};

/**
 * 提醒推送目标的读写。订阅与自动记账规则共用同一张表、同一套校验，
 * 因此抽在通用层——两边各写一遍必然会有一边漏掉成员校验。
 */
@Injectable()
export class ReminderTargetsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 覆盖式重写某个业务对象的飞书推送目标。
   *
   * 两道校验缺一不可：绑定必须仍生效（解绑是软删，行还在），且绑定所属用户必须仍是本账本成员
   * ——否则退出账本的人还能继续收到这个账本的推送。发送时会再校验一次（见 worker 侧调度器），
   * 因为这里通过之后成员关系仍可能变化。
   */
  async replace(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    sourceType: ReminderTargetSourceType,
    sourceId: string,
    bindingIds: string[],
  ): Promise<void> {
    const unique = Array.from(new Set(bindingIds));
    if (unique.length) {
      const bindings = await tx.feishuBinding.findMany({
        where: { id: { in: unique }, revokedAt: null },
        select: { id: true, userId: true },
      });
      if (bindings.length !== unique.length) {
        throw new AppError("FEISHU_BINDING_NOT_FOUND", "飞书绑定不存在或已解绑", 404);
      }
      const members = await tx.ledgerMember.findMany({
        where: { ledgerId, userId: { in: bindings.map((b) => b.userId) }, removedAt: null },
        select: { userId: true },
      });
      const memberIds = new Set(members.map((member) => member.userId));
      if (bindings.some((binding) => !memberIds.has(binding.userId))) {
        throw new AppError("FEISHU_BINDING_NOT_MEMBER", "该飞书账号的用户不是本账本成员", 403);
      }
    }
    await tx.reminderTarget.deleteMany({ where: { sourceType, sourceId, channel: "feishu" } });
    if (unique.length) {
      await tx.reminderTarget.createMany({
        data: unique.map((feishuBindingId) => ({
          ledgerId,
          sourceType,
          sourceId,
          channel: "feishu",
          feishuBindingId,
        })),
      });
    }
  }

  /**
   * 批量取推送目标（供列表用）。已解绑的绑定在这里被过滤掉，
   * 因此前端看到的永远是「当前真的会收到推送的账号」。
   */
  async load(
    sourceType: ReminderTargetSourceType,
    sourceIds: string[],
  ): Promise<Map<string, ReminderTargetSummary[]>> {
    const result = new Map<string, ReminderTargetSummary[]>();
    if (!sourceIds.length) return result;
    const targets = await this.prisma.client.reminderTarget.findMany({
      where: { sourceType, sourceId: { in: sourceIds }, channel: "feishu" },
    });
    if (!targets.length) return result;
    const bindings = await this.prisma.client.feishuBinding.findMany({
      where: { id: { in: targets.map((target) => target.feishuBindingId) }, revokedAt: null },
      select: { id: true, displayName: true, openId: true },
    });
    const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
    for (const target of targets) {
      const binding = bindingById.get(target.feishuBindingId);
      if (!binding) continue;
      const bucket = result.get(target.sourceId) ?? [];
      bucket.push({
        id: binding.id,
        displayName: binding.displayName,
        openIdSuffix: binding.openId.slice(-6),
      });
      result.set(target.sourceId, bucket);
    }
    return result;
  }

  /** 单个对象的推送目标字段，展开进响应体。 */
  async field(
    sourceType: ReminderTargetSourceType,
    sourceId: string,
  ): Promise<{ remindFeishuBindings: ReminderTargetSummary[] }> {
    const targets = await this.load(sourceType, [sourceId]);
    return { remindFeishuBindings: targets.get(sourceId) ?? [] };
  }
}
