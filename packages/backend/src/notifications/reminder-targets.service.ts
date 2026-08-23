import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { AppError } from "../errors/app-error";
import { FeishuClient } from "../feishu/feishu-client";
import { PrismaService } from "../prisma/prisma.service";
import { WebPushClient } from "../push/web-push.client";
import { NotificationChannel, ReminderTargetSourceType } from "./notifications.types";

/** 响应体里的推送接收人：够前端渲染选中项即可，不含账本信息。 */
export type ReminderTargetSummary = {
  /** 用户 id。前端提交时原样回传。 */
  userId: string;
  alias: string;
  /**
   * 这个人**当前真能收到**的渠道。空数组 = 选了却收不到（没绑飞书、也没订阅 Web Push，
   * 或两个开关都关了），前端据此给出「收不到」的提示——静默不发是最难排查的故障。
   */
  channels: NotificationChannel[];
};

/**
 * 提醒推送接收人的读写。订阅档位、自动记账规则、记账提醒共用同一张表、同一套校验。
 *
 * **只认「人」不认「端点」**：配置者回答的是「推给谁」，走飞书还是 Web Push 由接收人
 * 自己在通知设置里决定（见 `NotificationTargetsResolver`）。改造前这里存的是飞书绑定 id，
 * 那个粒度既让配置者去选「张三的飞书」这种别扭的东西，又意味着每加一条渠道就要在
 * 每张业务表单上再加一列同形态的多选。
 */
@Injectable()
export class ReminderTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feishu: FeishuClient,
    private readonly webPush: WebPushClient,
  ) {}

  /**
   * 覆盖式重写某个业务对象的推送接收人。
   *
   * 只剩一道校验：目标必须是本账本的在册成员——否则退出账本的人还能继续收到这个账本的推送。
   * （改造前还要额外校验「飞书绑定生效」，现在绑定与否是接收人自己的事，与配置无关。）
   * 发送时会再校验一次成员身份，因为这里通过之后成员关系仍可能变化。
   */
  async replace(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    sourceType: ReminderTargetSourceType,
    sourceId: string,
    userIds: string[],
  ): Promise<void> {
    const unique = Array.from(new Set(userIds));
    if (unique.length) {
      const members = await tx.ledgerMember.findMany({
        where: { ledgerId, userId: { in: unique }, removedAt: null },
        select: { userId: true },
      });
      if (members.length !== unique.length) {
        throw new AppError("REMINDER_TARGET_NOT_MEMBER", "推送接收人必须是本账本成员", 403);
      }
    }
    await tx.reminderTarget.deleteMany({ where: { sourceType, sourceId } });
    if (unique.length) {
      await tx.reminderTarget.createMany({
        data: unique.map((userId) => ({ ledgerId, sourceType, sourceId, userId })),
      });
    }
  }

  /**
   * 批量取接收人（供列表用），带上每人当前可达的渠道。
   *
   * 渠道可达性在**读取时现算**而不是存下来：用户随时可能解绑飞书、换设备、关开关，
   * 存一份必然会过期，而过期的「已配好」提示比没有提示更糟。
   */
  async load(
    sourceType: ReminderTargetSourceType,
    sourceIds: string[],
  ): Promise<Map<string, ReminderTargetSummary[]>> {
    const result = new Map<string, ReminderTargetSummary[]>();
    if (!sourceIds.length) return result;
    const targets = await this.prisma.client.reminderTarget.findMany({
      where: { sourceType, sourceId: { in: sourceIds } },
    });
    if (!targets.length) return result;

    const [summaries, members] = await Promise.all([
      this.summarize(targets.map((target) => target.userId)),
      // 已退出账本的接收人要在**读取时**就滤掉，与 {@link candidates} 的范围保持一致。
      // 不滤的话，表单会把这个 id 原样回填进草稿，用户改个名字再保存就撞上
      // replace() 的成员校验，得到一句莫名其妙的「推送接收人必须是本账本成员」。
      //
      // 注意这只是「读取时不可见」，不是保留：`replace()` 是整源覆盖，而提交上来的 id
      // 正是从这里过滤后的结果，所以**下一次保存该对象就会把这行抹掉**。这是可接受的——
      // 一个已经退群的人本来也收不到推送，与其留一份看不见又会在保存时消失的状态，
      // 不如让它随下一次编辑自然清掉。
      this.prisma.client.ledgerMember.findMany({
        where: {
          ledgerId: { in: Array.from(new Set(targets.map((target) => target.ledgerId))) },
          userId: { in: Array.from(new Set(targets.map((target) => target.userId))) },
          removedAt: null,
        },
        select: { ledgerId: true, userId: true },
      }),
    ]);
    const memberKeys = new Set(members.map((member) => `${member.ledgerId}:${member.userId}`));

    for (const target of targets) {
      const summary = summaries.get(target.userId);
      // 用户被删（本项目不物理删用户，但备份恢复等边界仍可能出现）时直接略过，不渲染空壳。
      if (!summary) continue;
      if (!memberKeys.has(`${target.ledgerId}:${target.userId}`)) continue;
      const bucket = result.get(target.sourceId) ?? [];
      bucket.push(summary);
      result.set(target.sourceId, bucket);
    }
    return result;
  }

  /** 单个对象的接收人字段，展开进响应体。 */
  async field(
    sourceType: ReminderTargetSourceType,
    sourceId: string,
  ): Promise<{ notifyTargets: ReminderTargetSummary[] }> {
    const targets = await this.load(sourceType, [sourceId]);
    return { notifyTargets: targets.get(sourceId) ?? [] };
  }

  /**
   * 候选接收人：本账本的全部在册成员 + 每人当前可达的渠道。
   *
   * 与 `load` 的差别是范围——那个是「已选了谁」，这个是「能选谁」。一个渠道都不可达的成员
   * 仍然列出（不隐藏）：家里那位还没装 PWA、也没绑飞书时，配置者需要看见他并去催，
   * 而不是在列表里找不到人。
   */
  async candidates(ledgerId: string): Promise<ReminderTargetSummary[]> {
    const members = await this.prisma.client.ledgerMember.findMany({
      where: { ledgerId, removedAt: null },
      select: { userId: true },
    });
    if (!members.length) return [];
    const summaries = await this.summarize(members.map((member) => member.userId));
    return Array.from(summaries.values()).sort((a, b) => a.alias.localeCompare(b.alias, "zh-Hans"));
  }

  /** userId → 展示名 + 可达渠道。禁用的账号不返回：他已经登不进来，推给他没有意义。 */
  private async summarize(userIds: string[]): Promise<Map<string, ReminderTargetSummary>> {
    const unique = Array.from(new Set(userIds));
    const result = new Map<string, ReminderTargetSummary>();
    if (!unique.length) return result;

    const [users, bindings, subscriptions] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: unique }, disabledAt: null },
        select: { id: true, alias: true, notifyFeishu: true, notifyWebPush: true },
      }),
      this.feishu.enabled
        ? this.prisma.client.feishuBinding.findMany({
            where: { userId: { in: unique }, revokedAt: null },
            select: { userId: true },
          })
        : Promise.resolve([]),
      this.webPush.enabled
        ? this.prisma.client.pushSubscription.findMany({
            where: { userId: { in: unique } },
            select: { userId: true },
            // 只问「有没有」，一台设备一行会把结果放大好几倍。
            distinct: ["userId"],
          })
        : Promise.resolve([]),
    ]);
    const boundToFeishu = new Set(bindings.map((row) => row.userId));
    const subscribed = new Set(subscriptions.map((row) => row.userId));

    for (const user of users) {
      const channels: NotificationChannel[] = [];
      if (user.notifyFeishu && boundToFeishu.has(user.id)) channels.push("feishu");
      if (user.notifyWebPush && subscribed.has(user.id)) channels.push("webpush");
      result.set(user.id, { userId: user.id, alias: user.alias, channels });
    }
    return result;
  }
}
