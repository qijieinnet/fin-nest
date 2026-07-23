import { NotificationActionKey, NotificationPayload } from "./notifications.types";

/**
 * 推送卡片渲染。发送侧（worker）与回写侧（api 的卡片回调）共用，保证点击前后是同一张卡的形态。
 *
 * 与 `feishu-cards.ts`（AI 卡片）刻意分开：那边的输入是 AiCard、要处理金额与图表，
 * 这边的输入是通用 payload，只有标题 / 文本行 / 按钮三种元素。
 *
 * 按钮 value **只放 notificationId**：ledgerId、subscriptionId 都是客户端可篡改的输入，
 * 服务端一律从库里反查（docs/FEISHU_BOT_PLAN.md §8）。
 */
export type NotificationCardBody = Record<string, unknown>;

export type NotificationActionValue = {
  action: NotificationActionKey;
  notificationId: string;
};

/** 点击后的终态描述，渲染成卡片底部的说明并撤掉按钮。 */
export type NotificationCardResult = {
  /** 「已确认续订」这类结论。 */
  summary: string;
  /** 操作者展示名；并发抢占失败时用来说明「已由谁处理」。 */
  actorName?: string | null;
  /** 补充信息，如新的下次续费日。 */
  detail?: string | null;
};

export function renderNotificationCard(
  notificationId: string,
  payload: NotificationPayload,
  result?: NotificationCardResult | null,
): NotificationCardBody {
  const elements: NotificationCardBody[] = [];

  const lines = [payload.leadDescription, ...payload.lines].filter(
    (line): line is string => Boolean(line),
  );
  if (lines.length > 0) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: lines.map(escapeMd).join("\n") } });
  }

  if (result) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "note", elements: [{ tag: "plain_text", content: resultNote(result) }] });
  } else if (payload.actions?.length) {
    elements.push({
      tag: "action",
      actions: payload.actions.map((action) => ({
        tag: "button",
        text: { tag: "plain_text", content: action.label },
        type: action.style,
        value: { action: action.key, notificationId } satisfies NotificationActionValue,
      })),
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: result ? "grey" : "orange",
      title: { tag: "plain_text", content: payload.title },
    },
    elements,
  };
}

/** 纯文本回退：渠道不支持卡片、或 payload 结构异常时用。 */
export function renderNotificationText(payload: NotificationPayload): string {
  const lead = payload.leadDescription ? `（${payload.leadDescription}）` : "";
  return [`${payload.title}${lead}`, ...payload.lines].join("\n");
}

function resultNote(result: NotificationCardResult): string {
  const actor = result.actorName ? `${result.actorName} · ` : "";
  const detail = result.detail ? `\n${result.detail}` : "";
  return `${actor}${result.summary}${detail}`;
}

/** lark_md 里 `*` `_` 等有语义，订阅名/服务商可能含这些字符，转义掉避免串版。 */
function escapeMd(text: string): string {
  return text.replace(/([*_~`[\]])/g, "\\$1");
}
