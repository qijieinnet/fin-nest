import { Injectable } from "@nestjs/common";
import {
  AppError,
  FeishuClient,
  NotificationPayload,
  normalizePayload,
  PrismaService,
  PushDeliveryService,
  ReminderTargetsService,
  WebPushClient,
} from "@fin-nest/backend";
import { deviceLabelFromUserAgent } from "../auth/device-label";
import { LedgersService } from "../ledgers/ledgers.service";
import { NotificationActionsService, SUMMARY_BY_STATE } from "./notification-actions.service";
import { SavePushSubscriptionDto } from "./dto/push-subscription.dto";

/** 通知设置页要的全部信息，一次取回：渠道可用性 + 我的开关 + 我的设备。 */
export type NotificationSettingsView = {
  /** 部署是否配了飞书 / VAPID。没配的渠道在前端整块隐藏，而不是显示一个点不动的开关。 */
  channels: { feishu: boolean; webPush: boolean };
  /** 我的渠道开关。 */
  notifyFeishu: boolean;
  notifyWebPush: boolean;
  /** 前端做 `pushManager.subscribe()` 用的 VAPID 公钥；未启用为 null。 */
  vapidPublicKey: string | null;
  /** 我已绑定的飞书号（尾段），用于说明「飞书这条通路当前通不通」。 */
  feishuBindings: Array<{ id: string; displayName: string | null; openIdSuffix: string }>;
  devices: PushDeviceView[];
};

export type PushDeviceView = {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  /** 这一条是不是当前这台设备提交的订阅（按 endpoint 比对，由前端传入自己的 endpoint 判定）。 */
  current: boolean;
};

/** 落地页 `/n/{id}` 要渲染的一条提醒。 */
export type NotificationView = {
  id: string;
  ledgerId: string;
  sourceType: string;
  sourceId: string;
  payload: NotificationPayload;
  /** null = 尚未处理，按钮可点。 */
  actionState: string | null;
  /** 终态描述 + 处理人，仅 actionState 非空时有值。 */
  resultSummary: string | null;
  actedByAlias: string | null;
  actedAt: string | null;
  scheduledAt: string;
};

/**
 * 通知设置、Web Push 订阅、以及推送落地页的读写。
 *
 * 三件事放在同一个 service 是因为它们围绕同一个问题：「我这个人能不能收到推送」。
 * 收件人的**选择**（谁收）在 `ReminderTargetsService`，那是账本维度的；这里是账号维度的。
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
    private readonly feishu: FeishuClient,
    private readonly webPush: WebPushClient,
    private readonly reminderTargets: ReminderTargetsService,
    private readonly pushDelivery: PushDeliveryService,
    private readonly actions: NotificationActionsService,
  ) {}

  async settings(userId: string, currentEndpoint?: string): Promise<NotificationSettingsView> {
    const [user, bindings, devices] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { notifyFeishu: true, notifyWebPush: true },
      }),
      this.feishu.enabled
        ? this.prisma.client.feishuBinding.findMany({
            where: { userId, revokedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, displayName: true, openId: true },
          })
        : Promise.resolve([]),
      this.prisma.client.pushSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return {
      channels: { feishu: this.feishu.enabled, webPush: this.webPush.enabled },
      notifyFeishu: user.notifyFeishu,
      notifyWebPush: user.notifyWebPush,
      vapidPublicKey: this.webPush.publicKey,
      feishuBindings: bindings.map((binding) => ({
        id: binding.id,
        displayName: binding.displayName,
        openIdSuffix: binding.openId.slice(-6),
      })),
      devices: devices.map((device) => ({
        id: device.id,
        deviceLabel: device.deviceLabel,
        createdAt: device.createdAt.toISOString(),
        lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
        current: Boolean(currentEndpoint) && device.endpoint === currentEndpoint,
      })),
    };
  }

  /** 渠道开关。只改传了的那个，两个都不传等于读一次。 */
  async updateSettings(
    userId: string,
    input: { notifyFeishu?: boolean; notifyWebPush?: boolean },
  ): Promise<NotificationSettingsView> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(input.notifyFeishu === undefined ? {} : { notifyFeishu: input.notifyFeishu }),
        ...(input.notifyWebPush === undefined ? {} : { notifyWebPush: input.notifyWebPush }),
      },
    });
    return this.settings(userId);
  }

  /**
   * 登记/更新本设备的 Web Push 订阅。
   *
   * 按 endpoint upsert 而不是插新行：浏览器重新订阅常常拿回**同一个 endpoint 但轮换了密钥**，
   * 插新行会撞唯一约束，用旧密钥加密则解不开（用户表现为「授权了却收不到」）。
   *
   * 前端在每次应用启动时都会调一遍（不只是首次授权）。这是刻意的自愈设计：系统备份恢复到
   * 旧快照、或订阅被服务端按失效删掉之后，浏览器侧其实还握着有效订阅，只有靠这次重新登记
   * 才能把它补回来——否则用户看到的是「权限已授予」，实际却再也收不到任何推送。
   */
  async saveSubscription(
    userId: string,
    input: SavePushSubscriptionDto,
    userAgent: string | null,
  ): Promise<PushDeviceView> {
    if (!this.webPush.enabled) {
      throw new AppError("WEB_PUSH_DISABLED", "本部署未启用 Web Push（缺少 VAPID 配置）", 400);
    }
    const deviceLabel = input.deviceLabel?.trim() || deviceLabelFromUserAgent(userAgent);
    const saved = await this.prisma.client.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        deviceLabel,
        userAgent,
      },
      // endpoint 被另一个账号复用（同一台设备换人登录）时连 userId 一起改写：
      // 订阅是浏览器的，不是账号的，留给旧账号会把提醒推给现在的使用者。
      update: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        deviceLabel,
        userAgent,
        failureCount: 0,
        lastError: null,
      },
    });
    return {
      id: saved.id,
      deviceLabel: saved.deviceLabel,
      createdAt: saved.createdAt.toISOString(),
      lastSuccessAt: saved.lastSuccessAt?.toISOString() ?? null,
      current: true,
    };
  }

  /** 按 endpoint 退订（本设备关掉通知时调用）。找不到也算成功——目标状态已经达到。 */
  async removeSubscriptionByEndpoint(userId: string, endpoint: string): Promise<void> {
    await this.prisma.client.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** 按 id 移除某台设备（在设置页把别的设备踢掉）。只能删自己的。 */
  async removeSubscription(userId: string, id: string): Promise<void> {
    const deleted = await this.prisma.client.pushSubscription.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new AppError("PUSH_SUBSCRIPTION_NOT_FOUND", "该推送设备不存在", 404);
    }
  }

  /**
   * 给自己的所有设备发一条测试通知。
   *
   * 这是 Web Push 唯一靠谱的自检手段：权限、Service Worker、VAPID 配置、推送服务可达性
   * 四者缺一不可，而前三者在浏览器里看起来都是「已就绪」。返回成功台数让用户自己判断。
   */
  async sendTest(userId: string): Promise<{ delivered: number; failed: number }> {
    if (!this.webPush.enabled) {
      throw new AppError("WEB_PUSH_DISABLED", "本部署未启用 Web Push（缺少 VAPID 配置）", 400);
    }
    const subscriptions = await this.prisma.client.pushSubscription.findMany({
      where: { userId },
    });
    if (!subscriptions.length) {
      throw new AppError("PUSH_SUBSCRIPTION_NOT_FOUND", "当前账号还没有已订阅的设备", 400);
    }

    // 善后规则与到点推送完全一致（见 PushDeliveryService）：这正是清掉
    // 「删了主屏图标又装回来」留下的死订阅的时机。
    const report = await this.pushDelivery.deliver(subscriptions, {
      title: "Fin Nest 测试通知",
      body: "能看到这条，说明推送链路是通的。",
      url: "/more/notifications",
      tag: "fin-nest-test",
      requireInteraction: false,
    });
    return { delivered: report.delivered, failed: report.failed };
  }

  /** 候选接收人（本账本成员 + 各自当前可达的渠道）。 */
  async candidates(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.reminderTargets.candidates(ledgerId);
  }

  /**
   * 落地页要的一条提醒。
   *
   * 鉴权判据与飞书卡片一致：**本账本成员即可查看与操作**——推送本就可能发给配偶等其他成员，
   * 他们点开理应能处理。不是成员则 assertMember 抛 403。
   */
  async view(notificationId: string, userId: string): Promise<NotificationView> {
    const notification = await this.actions.require(notificationId);
    await this.ledgers.assertMember(notification.ledgerId, userId);

    const actor = notification.actedBy
      ? await this.prisma.client.user.findFirst({
          where: { id: notification.actedBy },
          select: { alias: true },
        })
      : null;
    return {
      id: notification.id,
      ledgerId: notification.ledgerId,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
      payload: normalizePayload(notification.payload),
      actionState: notification.actionState,
      resultSummary: notification.actionState
        ? (SUMMARY_BY_STATE[notification.actionState] ?? "已处理")
        : null,
      actedByAlias: actor?.alias ?? null,
      actedAt: notification.actedAt?.toISOString() ?? null,
      scheduledAt: notification.scheduledAt.toISOString(),
    };
  }

  /** 落地页点按钮。执行前同样要 assertMember——路由参数是用户可控的。 */
  async act(
    notificationId: string,
    action: Parameters<NotificationActionsService["execute"]>[1],
    userId: string,
  ): Promise<NotificationView & { status: string; detail: string | null }> {
    const notification = await this.actions.require(notificationId);
    await this.ledgers.assertMember(notification.ledgerId, userId);
    const outcome = await this.actions.execute(notificationId, action, userId);
    return {
      ...(await this.view(notificationId, userId)),
      status: outcome.status,
      detail: outcome.detail,
    };
  }
}
