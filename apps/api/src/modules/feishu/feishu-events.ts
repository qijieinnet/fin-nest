/**
 * 飞书原始事件 → 内部归一化结构。纯函数，不依赖 SDK 类型，可离线单测。
 *
 * 收件箱里存的是原始 payload（便于排障），消费时再归一化，
 * 因此 WS handler 与消费者共用这一份解析逻辑。
 */

export type FeishuIncomingMessage = {
  eventId: string;
  openId: string;
  unionId: string | null;
  chatId: string;
  /** p2p = 私聊；group = 群聊。绑定只在私聊接受。 */
  chatType: string;
  messageId: string;
  /** 已去掉 @ 提及占位符的纯文本。 */
  text: string;
  /** 群聊里是否 @ 了机器人；私聊恒为 true（无需 @）。 */
  mentionedBot: boolean;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null ? (value as RawRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 从事件里取 event_id；收件箱去重依赖它，取不到就没法去重，直接丢弃。 */
export function extractEventId(raw: unknown): string | null {
  const event = asRecord(raw);
  if (!event) return null;
  // 长连接下事件体可能是 { header: { event_id }, event: {...} }（v2 schema），
  // 也可能是扁平结构（v1）；两种都试。
  const header = asRecord(event.header);
  return asString(header?.event_id) ?? asString(event.event_id);
}

/**
 * 归一化一条 im.message.receive_v1。
 * 非文本消息（图片/文件/语音等）返回 null —— P2 只处理纯文本。
 */
export function normalizeMessageEvent(raw: unknown): FeishuIncomingMessage | null {
  const event = asRecord(raw);
  if (!event) return null;

  const body = asRecord(event.event) ?? event;
  const eventId = extractEventId(raw);
  if (!eventId) return null;

  const sender = asRecord(body.sender);
  const senderId = asRecord(sender?.sender_id);
  const openId = asString(senderId?.open_id);
  if (!openId) return null;

  const message = asRecord(body.message);
  const chatId = asString(message?.chat_id);
  const messageId = asString(message?.message_id);
  if (!chatId || !messageId) return null;

  if (asString(message?.message_type) !== "text") return null;

  const text = parseTextContent(asString(message?.content));
  if (text === null) return null;

  const chatType = asString(message?.chat_type) ?? "p2p";
  const mentions = Array.isArray(message?.mentions) ? message.mentions : [];

  return {
    eventId,
    openId,
    unionId: asString(senderId?.union_id),
    chatId,
    chatType,
    messageId,
    text: stripMentionPlaceholders(text),
    // 私聊无需 @；群聊必须 @ 了机器人才响应（是否是机器人由 mentions 非空近似判断，
    // 因为事件里拿不到自身 open_id —— 群里 @ 其他人不会把消息推给机器人）。
    mentionedBot: chatType === "p2p" ? true : mentions.length > 0,
  };
}

/** 文本消息的 content 是 JSON 字符串：`{"text":"..."}`。 */
function parseTextContent(content: string | null): string | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}

/** @ 在文本里表现为 `@_user_1` 占位符，去掉后再交给指令解析与模型。 */
export function stripMentionPlaceholders(text: string): string {
  return text.replace(/@_user_\d+/g, "").trim();
}
