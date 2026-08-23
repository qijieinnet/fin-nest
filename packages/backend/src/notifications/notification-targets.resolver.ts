import { Injectable } from "@nestjs/common";
import { FeishuClient } from "../feishu/feishu-client";
import { PrismaService } from "../prisma/prisma.service";
import { WebPushClient } from "../push/web-push.client";
import { NotificationChannel } from "./notifications.types";

/** 一个「可投递的收件端」。channel 决定 targetRef 的语义，见 schema.prisma 的 Notification。 */
export type DeliveryTarget = {
  channel: NotificationChannel;
  targetRef: string;
};

/** 一个用户在推送侧的全貌：能收到哪些渠道，以及他在哪些账本里还是成员。 */
export type ResolvedRecipient = {
  userId: string;
  /** 当前真的能投递的渠道。用户关了开关、或压根没绑/没订阅，这里就是空数组。 */
  targets: DeliveryTarget[];
  /** 仍生效的账本成员身份。发送前要再校验一次：配置时是成员，之后可能已退出。 */
  ledgerIds: Set<string>;
};

/**
 * 「推给谁」→「往哪几个端点发」。
 *
 * 整个推送渠道整合的枢纽：`reminder_targets` 只存 userId，调度器拿到一批 userId 后
 * 用这里展开成具体端点。新增一条渠道只需要在 {@link resolve} 里多拼一段，
 * 业务表单、DTO、前端选择器一律不动。
 *
 * 展开口径按渠道不同：
 * - **飞书**：一个用户可能有多条生效绑定（换过飞书号且都没解绑），每条都是独立收件人，
 *   各自一条 notification（这与改造前一致）。
 * - **Web Push**：一个用户的多台设备共享**一条** notification（targetRef = userId），
 *   发送时才展开成多次投递。否则用户新装一台设备就会让同一条提醒重发一遍，
 *   而且 dedupeKey 会随设备增减而漂移。
 */
@Injectable()
export class NotificationTargetsResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feishu: FeishuClient,
    private readonly webPush: WebPushClient,
  ) {}

  /**
   * 批量解析收件人。返回 Map 便于调度器按 userId 取用；查不到的用户（已删/已禁用）不会出现在结果里。
   *
   * 被禁用的账号一并排除：`disabledAt` 之后这个人已经登不进来了，还给他推提醒没有意义。
   */
  async resolve(userIds: string[]): Promise<Map<string, ResolvedRecipient>> {
    const result = new Map<string, ResolvedRecipient>();
    const unique = Array.from(new Set(userIds));
    if (!unique.length) return result;

    const [users, bindings, subscriptions, memberships] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: unique }, disabledAt: null },
        select: { id: true, notifyFeishu: true, notifyWebPush: true },
      }),
      this.feishu.enabled
        ? this.prisma.client.feishuBinding.findMany({
            where: { userId: { in: unique }, revokedAt: null },
            select: { userId: true, openId: true },
          })
        : Promise.resolve([]),
      this.webPush.enabled
        ? this.prisma.client.pushSubscription.findMany({
            where: { userId: { in: unique } },
            select: { userId: true },
            distinct: ["userId"],
          })
        : Promise.resolve([]),
      this.prisma.client.ledgerMember.findMany({
        where: { userId: { in: unique }, removedAt: null },
        select: { userId: true, ledgerId: true },
      }),
    ]);

    const openIdsByUser = new Map<string, string[]>();
    for (const binding of bindings) {
      const bucket = openIdsByUser.get(binding.userId) ?? [];
      bucket.push(binding.openId);
      openIdsByUser.set(binding.userId, bucket);
    }
    const hasSubscription = new Set(subscriptions.map((row) => row.userId));
    const ledgersByUser = new Map<string, Set<string>>();
    for (const member of memberships) {
      const bucket = ledgersByUser.get(member.userId) ?? new Set<string>();
      bucket.add(member.ledgerId);
      ledgersByUser.set(member.userId, bucket);
    }

    for (const user of users) {
      const targets: DeliveryTarget[] = [];
      if (user.notifyFeishu) {
        for (const openId of openIdsByUser.get(user.id) ?? []) {
          targets.push({ channel: "feishu", targetRef: openId });
        }
      }
      // Web Push 只在这个人**确实有活订阅**时才排：排了却没设备，等于白白生成一条
      // 永远发不出去的 pending 行，把 attempts 烧光后落 failed，污染排查视野。
      if (user.notifyWebPush && hasSubscription.has(user.id)) {
        targets.push({ channel: "webpush", targetRef: user.id });
      }
      result.set(user.id, {
        userId: user.id,
        targets,
        ledgerIds: ledgersByUser.get(user.id) ?? new Set<string>(),
      });
    }
    return result;
  }
}
