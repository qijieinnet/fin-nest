import {
  NotificationActionKey,
  NotificationAmount,
  NotificationAmountTone,
  NotificationField,
  NotificationPayload,
} from "./notifications.types";

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

/**
 * 语义色 → 飞书色号。
 *
 * lark_md 的字体色**只有 red / green / grey 三档**（`<text_tag>` 的十来种色号不适用于正文文本），
 * 所以支出绿、收入红能与前端详情对上，转账的黄色没有对应值——退回 grey，
 * 比借用一个语义不同的颜色更不误导。
 */
const AMOUNT_COLORS: Record<NotificationAmountTone, string> = {
  expense: "green",
  income: "red",
  transfer: "grey",
};

/** 超过这个长度的值独占一行，避免备注这类长文本把双列网格挤变形（半列约放得下十个汉字）。 */
const WIDE_VALUE_LENGTH = 10;

export function renderNotificationCard(
  notificationId: string,
  payload: NotificationPayload,
  result?: NotificationCardResult | null,
): NotificationCardBody {
  const elements: NotificationCardBody[] = [];

  if (payload.leadDescription) {
    elements.push(divText(escapeMd(payload.leadDescription)));
  }
  if (payload.amount) {
    elements.push(divText(amountMarkdown(payload.amount)));
  }
  if (payload.fields.length > 0) {
    elements.push(fieldGrid(payload.fields));
  } else if (payload.lines?.length) {
    // 旧结构的历史行：整行文本原样渲染。
    elements.push(divText(payload.lines.map(escapeMd).join("\n")));
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

function divText(content: string): NotificationCardBody {
  return { tag: "div", text: { tag: "lark_md", content } };
}

/**
 * 双列字段网格。备注这类长值独占整行，否则它会把同排的另一个字段挤成一条窄缝。
 *
 * `is_short: false` 表示独占整行，所以还要跟着排版走一遍：一个落单的半宽字段
 * （它右边没有下一个半宽字段了）也得转成整行，不然飞书会在它右侧留一块空白。
 */
function fieldGrid(fields: NotificationField[]): NotificationCardBody {
  const wide = fields.map((field) => field.value.length > WIDE_VALUE_LENGTH);
  for (let index = 0; index < fields.length; index += 1) {
    if (wide[index]) continue;
    const pairedWithNext = index + 1 < fields.length && !wide[index + 1];
    if (pairedWithNext) index += 1;
    else wide[index] = true;
  }

  return {
    tag: "div",
    fields: fields.map((field, index) => ({
      is_short: !wide[index],
      text: { tag: "lark_md", content: `**${field.label}**\n${escapeMd(field.value)}` },
    })),
  };
}

/** 金额加粗着色。文本由构造方格式化好，这里不做任何金额换算。 */
function amountMarkdown(amount: NotificationAmount): string {
  return `**<font color='${AMOUNT_COLORS[amount.tone] ?? "grey"}'>${amount.text}</font>**`;
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
