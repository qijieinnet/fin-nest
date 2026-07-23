/** 目前只有飞书一条通道；新增渠道时在这里扩，`NotificationService` 的分发处会强制补齐分支。 */
export type NotificationChannel = "feishu";

export type NotificationSourceType = "subscription";

/**
 * 卡片按钮的动作标识。
 *
 * 定义在通用层是因为**发送侧**（调度器决定挂哪些按钮）与**处理侧**（api 的卡片回调）
 * 必须对同一组字符串达成一致；但每个动作具体做什么只有处理侧知道，通用层不关心。
 */
export type NotificationActionKey = "subscription_renew" | "subscription_terminate";

/** 动作执行后的终态，落到 `notifications.action_state`。 */
export type NotificationActionState = "renewed" | "terminated";

export type NotificationAction = {
  key: NotificationActionKey;
  label: string;
  /** 飞书按钮样式：primary 主操作、danger 危险操作、default 次要。 */
  style: "primary" | "danger" | "default";
};

/**
 * 一次「该发的提醒」。
 *
 * 推送层只认这个结构，不认订阅——因此提醒从单档扩到多档时，对推送层而言只是
 * 同一个订阅这次吐出多条 occurrence，派发/重试/去重一行都不用改；
 * 以后加「自动记账待确认」推送也只是换一组 payload.actions。
 */
export type ReminderOccurrence = {
  ledgerId: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  channel: NotificationChannel;
  /** 渠道内的收件标识，飞书为 open_id。 */
  targetRef: string;
  /** 幂等键，见 schema.prisma 里 Notification 的注释。 */
  dedupeKey: string;
  /** dedupeKey 去掉收件人段：同一次提醒事件的多个接收人共享，按钮动作按它抢占。 */
  occurrenceKey: string;
  scheduledAt: Date;
  payload: NotificationPayload;
};

/** 消息正文的结构化来源。渲染成什么样由渠道决定，调度器只负责给事实。 */
export type NotificationPayload = {
  kind: "subscription_due";
  title: string;
  /** 「还有 3 天」这类描述。多档提醒时每档不同，是区分同一订阅多条推送的关键信息。 */
  leadDescription: string;
  lines: string[];
  /** 卡片底部按钮；为空则发成不可操作的信息卡。 */
  actions?: NotificationAction[];
};
