import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "@fin-nest/config";
import webpush, { type PushSubscription as WebPushSubscription, WebPushError } from "web-push";

/** 一次投递的结果。调用方据此决定是否删订阅，因此把「过期」与「其它失败」分开。 */
export type WebPushDeliveryResult =
  | { ok: true }
  /** 推送服务明确说这个 endpoint 没了（404/410）：立刻删订阅，重试没有意义。 */
  | { ok: false; expired: true; error: string }
  /** 网络抖动、429、5xx 等：保留订阅，交由上层的 attempts 机制重试。 */
  | { ok: false; expired: false; error: string };

/** 推送内容。渲染由 `notification-web-push.ts` 负责，这里只管加密投递。 */
export type WebPushMessage = Record<string, unknown>;

/**
 * Web Push（RFC 8030 / 8291 / 8292）的投递客户端。
 *
 * 与飞书那条渠道的关键差别：**没有服务端 SDK 帮你找收件人**——endpoint 是浏览器给的一个
 * URL，服务端只是往它 POST 一段用订阅公钥加密的密文，由推送服务（iOS 为 Apple 的
 * web.push.apple.com，最终落到 APNs；Chrome 为 FCM）转投到设备。因此：
 * - 不需要 Apple 开发者账号、证书或上架，自部署可用；
 * - 但 endpoint 会静默失效（用户删掉主屏图标、系统清理、长期不用），必须处理 404/410。
 *
 * 加密与 VAPID 签名交给 `web-push` 库：这两段是 ECDH + HKDF + aes128gcm 与 ES256 JWT，
 * 自己写既没有收益、又只能靠线上真机才验得出错。
 */
@Injectable()
export class WebPushClient {
  private readonly logger = new Logger(WebPushClient.name);
  private readonly config = loadConfig();

  get enabled(): boolean {
    return Boolean(
      this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY && this.config.VAPID_SUBJECT,
    );
  }

  /** 下发给前端做 `pushManager.subscribe()` 的 applicationServerKey。未启用时为 null。 */
  get publicKey(): string | null {
    return this.enabled ? (this.config.VAPID_PUBLIC_KEY ?? null) : null;
  }

  /**
   * 投递一条通知。
   *
   * `TTL` 给 4 小时：到期提醒过了大半天再弹出来只会造成困惑，不如让推送服务丢弃。
   * `urgency: high` 让 iOS 在低电量模式下也尽快下发——这些都是用户主动配置的到点提醒，
   * 不是营销推送。
   */
  async send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    message: WebPushMessage,
  ): Promise<WebPushDeliveryResult> {
    if (!this.enabled) {
      return { ok: false, expired: false, error: "Web Push 未配置（缺少 VAPID 密钥）" };
    }
    const target: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    try {
      await webpush.sendNotification(target, JSON.stringify(message), {
        TTL: 4 * 60 * 60,
        urgency: "high",
        vapidDetails: {
          subject: this.config.VAPID_SUBJECT!,
          publicKey: this.config.VAPID_PUBLIC_KEY!,
          privateKey: this.config.VAPID_PRIVATE_KEY!,
        },
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof WebPushError) {
        // 404 = endpoint 不存在，410 = 订阅已被推送服务注销（用户删了主屏图标 / 关了权限）。
        const expired = error.statusCode === 404 || error.statusCode === 410;
        const detail = `${error.statusCode} ${error.body?.slice(0, 200) ?? error.message}`;
        if (!expired) {
          this.logger.warn(`Web Push 投递失败（${hostOf(subscription.endpoint)}）：${detail}`);
        }
        return { ok: false, expired, error: detail };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, expired: false, error: message };
    }
  }
}

/** 日志里只保留推送服务的主机名：endpoint 尾段是设备标识，属于用户隐私，不进日志。 */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}
