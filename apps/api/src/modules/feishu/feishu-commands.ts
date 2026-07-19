/**
 * 飞书消息文本 → 指令。纯函数，无依赖，可离线单测。
 *
 * 设计取舍：中文指令要求**整条消息完全匹配**（`绑定` 除外，它后面跟绑定码），
 * 否则「帮我看看这个月的帮助文档」会被误判成 `帮助`、「绑定信用卡年费怎么记」会被
 * 误判成绑定。斜杠形式无歧义，一律按指令处理。
 */

export type FeishuCommand =
  | { kind: "bind"; code: string }
  | { kind: "unbind" }
  | { kind: "switch_ledger"; name?: string }
  | { kind: "help" }
  | { kind: "new_conversation" }
  | { kind: "chat"; text: string };

/** 与 feishu-binding.service 的字符集保持一致：去掉 0/O/1/I/L。 */
const BIND_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}$/i;

const EXACT_COMMANDS: Record<string, FeishuCommand> = {
  解绑: { kind: "unbind" },
  "/unbind": { kind: "unbind" },
  帮助: { kind: "help" },
  "/help": { kind: "help" },
  新对话: { kind: "new_conversation" },
  "/new": { kind: "new_conversation" },
  切换账本: { kind: "switch_ledger" },
  "/ledger": { kind: "switch_ledger" },
};

export function parseCommand(rawText: string): FeishuCommand {
  const text = rawText.trim();
  if (text.length === 0) return { kind: "chat", text: "" };

  const exact = EXACT_COMMANDS[text.toLowerCase()] ?? EXACT_COMMANDS[text];
  if (exact) return exact;

  const bind = matchPrefix(text, ["绑定", "/bind"]);
  if (bind !== null) {
    // 只有「绑定 + 合法码型」才算绑定指令，否则当普通聊天，
    // 避免「绑定信用卡后怎么记账」被吃掉。
    if (BIND_CODE_PATTERN.test(bind)) return { kind: "bind", code: bind };
    return { kind: "chat", text };
  }

  const switchLedger = matchPrefix(text, ["切换账本", "/ledger"]);
  if (switchLedger !== null && switchLedger.length > 0) {
    return { kind: "switch_ledger", name: switchLedger };
  }

  return { kind: "chat", text };
}

/** 命中任一前缀则返回其后的剩余部分（已 trim）；都不命中返回 null。 */
function matchPrefix(text: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
      return text.slice(prefix.length).trim();
    }
  }
  return null;
}

export const HELP_TEXT = [
  "可以直接用自然语言记账或查询，例如：",
  "· 今天午饭 35",
  "· 这个月餐饮花了多少",
  "· 我的账户余额",
  "",
  "指令：",
  "· 切换账本 <账本名> — 切换当前账本（不带名称则列出可选）",
  "· 新对话 — 清空上下文重新开始",
  "· 解绑 — 解除本飞书账号的绑定",
  "· 帮助 — 显示本说明",
].join("\n");
