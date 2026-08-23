import { Injectable } from "@nestjs/common";
import type { PushSubscription } from "@fin-nest/db";
import { PrismaService } from "../prisma/prisma.service";
import { WebPushClient, type WebPushMessage } from "./web-push.client";

/**
 * 连续失败多少次就删掉订阅。
 *
 * 只对「非 404/410」的失败计数——那两种是明确的失效信号，一次就删。这里防的是另一类：
 * 推送服务持续返回 400/5xx 的死订阅，不设上限就永远清不掉，单设备用户会从此静默收不到
 * 任何提醒且毫无察觉。取 10 是因为成功一次即清零、前端每次启动重新登记也会清零，
 * 活跃设备几乎不可能累积到这个数。
 */
const MAX_CONSECUTIVE_FAILURES = 10;

export type PushDeliveryReport = {
  /** 成功投递的设备台数。 */
  delivered: number;
  failed: number;
  /** 每台失败设备的原因，形如 `iPhone · Safari: 410 gone`。用于写进 lastError 或回给界面。 */
  errors: string[];
};

/**
 * 往一个人的多台设备投递，并就地维护订阅的健康状态。
 *
 * 单独抽出来是因为**到点推送与「发送测试通知」必须用同一套善后规则**：成功清零失败计数、
 * 410/404 当场删订阅、其余错误累计到 {@link MAX_CONSECUTIVE_FAILURES} 再删。两边各写一遍的话，
 * 改一次策略必然漏掉另一边，而症状（某条路径上死订阅永远清不掉）要等到线上才看得出来。
 *
 * 写库一律走 `updateMany` / `deleteMany`：按 id 的 `update`/`delete` 在行已经不存在时抛 P2025，
 * 而这里天然会并发——用户点「发送测试通知」正好撞上 worker 派发同一批设备，两边都判定
 * 同一条订阅失效、都去删，后到的那次就会抛出去，把整份投递报告作废，已经收到的设备
 * 在重试时再收一遍。
 */
@Injectable()
export class PushDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webPush: WebPushClient,
  ) {}

  async deliver(
    subscriptions: PushSubscription[],
    message: WebPushMessage,
  ): Promise<PushDeliveryReport> {
    let delivered = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const subscription of subscriptions) {
      const result = await this.webPush.send(subscription, message);
      if (result.ok) {
        delivered += 1;
        await this.prisma.client.pushSubscription.updateMany({
          where: { id: subscription.id },
          data: { lastSuccessAt: new Date(), failureCount: 0, lastError: null },
        });
        continue;
      }

      failed += 1;
      errors.push(`${subscription.deviceLabel ?? subscription.id}: ${result.error}`);
      const failureCount = subscription.failureCount + 1;
      if (result.expired || failureCount >= MAX_CONSECUTIVE_FAILURES) {
        // 失效订阅不会自己恢复，留着只会让每条推送都多打一次无用请求。
        // 用户重新授权时前端会 upsert 出一条新的。
        await this.prisma.client.pushSubscription.deleteMany({ where: { id: subscription.id } });
      } else {
        await this.prisma.client.pushSubscription.updateMany({
          where: { id: subscription.id },
          data: { failureCount, lastError: result.error.slice(0, 500) },
        });
      }
    }

    return { delivered, failed, errors };
  }
}
