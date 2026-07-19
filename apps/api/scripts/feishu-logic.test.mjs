import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCardAction } from "../dist/modules/feishu/feishu-card-action.service.js";
import { escapeMd, renderCard } from "../dist/modules/feishu/feishu-cards.js";
import { parseCommand } from "../dist/modules/feishu/feishu-commands.js";
import {
  aiCardIdempotencyKey,
  draftToCreateTransaction,
} from "../dist/modules/feishu/feishu-draft.js";
import {
  extractEventId,
  normalizeMessageEvent,
  stripMentionPlaceholders,
} from "../dist/modules/feishu/feishu-events.js";
import { formatMicros, percentOf } from "../dist/modules/feishu/feishu-money.js";

// ---------------------------------------------------------------- 指令解析

test("斜杠指令与中文指令都能识别", () => {
  assert.deepEqual(parseCommand("/help"), { kind: "help" });
  assert.deepEqual(parseCommand("帮助"), { kind: "help" });
  assert.deepEqual(parseCommand("  解绑  "), { kind: "unbind" });
  assert.deepEqual(parseCommand("/new"), { kind: "new_conversation" });
  assert.deepEqual(parseCommand("切换账本"), { kind: "switch_ledger" });
  assert.deepEqual(parseCommand("切换账本 家庭账本"), {
    kind: "switch_ledger",
    name: "家庭账本",
  });
});

test("中文指令必须整条匹配，避免吃掉正常聊天", () => {
  // 这几条都以指令词开头或包含指令词，但显然是在聊天。
  assert.deepEqual(parseCommand("帮助我看看这个月花了多少"), {
    kind: "chat",
    text: "帮助我看看这个月花了多少",
  });
  assert.deepEqual(parseCommand("解绑信用卡要手续费吗"), {
    kind: "chat",
    text: "解绑信用卡要手续费吗",
  });
});

test("绑定指令只在跟着合法码型时才成立", () => {
  assert.deepEqual(parseCommand("绑定 K7M4-P2QX"), { kind: "bind", code: "K7M4-P2QX" });
  assert.deepEqual(parseCommand("/bind K7M4P2QX"), { kind: "bind", code: "K7M4P2QX" });
  // 小写也接受，服务端 normalize 时统一大写。
  assert.deepEqual(parseCommand("绑定 k7m4-p2qx"), { kind: "bind", code: "k7m4-p2qx" });
  // 「绑定」开头但后面不是码 → 普通聊天，不能吞掉。
  assert.deepEqual(parseCommand("绑定信用卡的年费怎么记"), {
    kind: "chat",
    text: "绑定信用卡的年费怎么记",
  });
  // 码型不合法（含被排除的易混字符 O/I/0/1）→ 不当作绑定。
  assert.equal(parseCommand("绑定 K7M4-P2QO").kind, "chat");
});

test("普通文本归为 chat", () => {
  assert.deepEqual(parseCommand("今天午饭 35"), { kind: "chat", text: "今天午饭 35" });
  assert.deepEqual(parseCommand("   "), { kind: "chat", text: "" });
});

// ---------------------------------------------------------------- 事件归一化

function buildMessageEvent(overrides = {}) {
  const {
    eventId = "evt-1",
    openId = "ou_abc",
    chatId = "oc_xyz",
    chatType = "p2p",
    messageType = "text",
    content = JSON.stringify({ text: "今天午饭 35" }),
    mentions,
  } = overrides;
  return {
    header: { event_id: eventId, event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: openId, union_id: "on_abc" }, sender_type: "user" },
      message: {
        message_id: "om_1",
        chat_id: chatId,
        chat_type: chatType,
        message_type: messageType,
        content,
        ...(mentions ? { mentions } : {}),
      },
    },
  };
}

test("event_id 同时支持 v2 header 与扁平结构", () => {
  assert.equal(extractEventId(buildMessageEvent()), "evt-1");
  assert.equal(extractEventId({ event_id: "flat-1" }), "flat-1");
  assert.equal(extractEventId(null), null);
  assert.equal(extractEventId({}), null);
});

test("归一化提取出身份与文本", () => {
  const message = normalizeMessageEvent(buildMessageEvent());
  assert.equal(message.eventId, "evt-1");
  assert.equal(message.openId, "ou_abc");
  assert.equal(message.chatId, "oc_xyz");
  assert.equal(message.text, "今天午饭 35");
  // 私聊无需 @ 即视为对机器人说话。
  assert.equal(message.mentionedBot, true);
});

test("群聊未 @ 机器人时标记为未提及", () => {
  const withoutMention = normalizeMessageEvent(buildMessageEvent({ chatType: "group" }));
  assert.equal(withoutMention.mentionedBot, false);

  const withMention = normalizeMessageEvent(
    buildMessageEvent({
      chatType: "group",
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Fin Nest" }],
      content: JSON.stringify({ text: "@_user_1 今天午饭 35" }),
    }),
  );
  assert.equal(withMention.mentionedBot, true);
  // @ 占位符不应进入指令解析与模型输入。
  assert.equal(withMention.text, "今天午饭 35");
});

test("非文本消息与残缺事件被丢弃", () => {
  assert.equal(normalizeMessageEvent(buildMessageEvent({ messageType: "image" })), null);
  assert.equal(normalizeMessageEvent(buildMessageEvent({ content: "not-json" })), null);
  assert.equal(normalizeMessageEvent(null), null);

  // 缺 event_id 就无法去重，必须丢弃（注意不能靠传 undefined，会被解构默认值补回来）。
  const noEventId = buildMessageEvent();
  delete noEventId.header.event_id;
  assert.equal(normalizeMessageEvent(noEventId), null);

  const noOpenId = buildMessageEvent();
  delete noOpenId.event.sender.sender_id.open_id;
  assert.equal(normalizeMessageEvent(noOpenId), null);
});

test("@ 占位符清理", () => {
  assert.equal(stripMentionPlaceholders("@_user_1 记一笔"), "记一笔");
  assert.equal(stripMentionPlaceholders("@_user_1 @_user_2 记一笔"), "记一笔");
  assert.equal(stripMentionPlaceholders("没有提及"), "没有提及");
});

// ---------------------------------------------------------------- 金额格式化

test("金额按账本小数位补零并加千分位", () => {
  assert.equal(formatMicros("35000000", 2, "CNY"), "¥35.00");
  assert.equal(formatMicros("1234567890000", 2, "CNY"), "¥1,234,567.89");
  assert.equal(formatMicros("35000000", 0, "JPY"), "¥35");
  assert.equal(formatMicros("-35500000", 2, "CNY"), "-¥35.50");
  assert.equal(formatMicros(0n, 2, "CNY"), "¥0.00");
});

test("未收录币种用代码前缀，不猜符号", () => {
  assert.equal(formatMicros("1000000", 2, "SGD"), "SGD 1.00");
  assert.equal(formatMicros("1000000", 2, null), "1.00");
});

test("小数位四舍五入而非截断", () => {
  // 0.125 → 2 位应进位到 0.13
  assert.equal(formatMicros("125000", 2, null), "0.13");
  assert.equal(formatMicros("124000", 2, null), "0.12");
});

test("异常小数位退回 2 位而不是崩掉", () => {
  assert.equal(formatMicros("1000000", 99, null), "1.00");
  assert.equal(formatMicros("1000000", -1, null), "1.00");
});

test("占比除零返回 0", () => {
  assert.equal(percentOf("50000000", "100000000"), 50);
  assert.equal(percentOf("1", "0"), 0);
});

// ---------------------------------------------------------------- 卡片渲染

const ctx = { decimalPlaces: 2, currency: "CNY", messageId: "msg-1", cardIndex: 3 };

function draftCard(overrides = {}) {
  return {
    kind: "transaction_draft",
    status: "proposed",
    draft: {
      type: "expense",
      grossAmountMicros: "35000000",
      occurredOn: "2026-07-20",
      categoryName: "餐饮",
      accountName: "招商银行",
      ...overrides.draft,
    },
    ...overrides,
  };
}

/** 递归找出卡片里所有 tag=button 的元素。 */
function findButtons(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) findButtons(item, found);
  } else if (node && typeof node === "object") {
    if (node.tag === "button") found.push(node);
    for (const value of Object.values(node)) findButtons(value, found);
  }
  return found;
}

test("待确认草稿卡带确认与作废按钮", () => {
  const buttons = findButtons(renderCard(draftCard(), ctx));
  assert.equal(buttons.length, 2);
  assert.deepEqual(
    buttons.map((b) => b.value.action),
    ["confirm_draft", "discard_draft"],
  );
});

test("按钮 value 只带 messageId 与 cardIndex，绝不带身份信息", () => {
  const [confirm] = findButtons(renderCard(draftCard(), ctx));
  // 这是 §8 鉴权成立的前提：身份一律服务端反查，客户端传什么都不信。
  assert.deepEqual(Object.keys(confirm.value).sort(), ["action", "cardIndex", "messageId"]);
  assert.equal(confirm.value.messageId, "msg-1");
  assert.equal(confirm.value.cardIndex, 3);
});

test("已确认或已作废的草稿卡不再给按钮", () => {
  assert.equal(findButtons(renderCard(draftCard({ status: "confirmed" }), ctx)).length, 0);
  assert.equal(findButtons(renderCard(draftCard({ status: "superseded" }), ctx)).length, 0);
});

test("被阻断确认的草稿卡不给按钮并说明原因", () => {
  const card = draftCard({ confirmationBlockedReason: "账户已归档" });
  const rendered = renderCard(card, ctx);
  assert.equal(findButtons(rendered).length, 0);
  assert.ok(JSON.stringify(rendered).includes("账户已归档"));
});

test("六种卡片都能渲染出合法结构", () => {
  const cards = [
    draftCard(),
    {
      kind: "transactions",
      title: "本月餐饮",
      count: 1,
      expenseMicros: "35000000",
      incomeMicros: "0",
      rows: [{ occurredOn: "2026-07-20", type: "expense", effectiveAmountMicros: "35000000" }],
    },
    {
      kind: "stats_period",
      title: "本月",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      expenseMicros: "35000000",
      incomeMicros: "0",
      expenseCategories: [{ name: "餐饮", amountMicros: "35000000" }],
      incomeCategories: [],
    },
    {
      kind: "account_balances",
      title: "账户余额",
      totalAssetsMicros: "100000000",
      totalLiabilitiesMicros: "0",
      netWorthMicros: "100000000",
      accounts: [{ name: "招行", type: "savings", balanceMicros: "100000000", isLiability: false }],
    },
    {
      kind: "budget_progress",
      month: "2026-07",
      enabled: true,
      totalBudgetMicros: "100000000",
      usedMicros: "35000000",
      remainingMicros: "65000000",
      percent: 35,
      categories: [],
    },
    {
      kind: "stats_month",
      month: "2026-07",
      expenseMicros: "35000000",
      incomeMicros: "0",
      topExpenseCategories: [{ name: "餐饮", amountMicros: "35000000" }],
    },
  ];

  for (const card of cards) {
    const rendered = renderCard(card, ctx);
    assert.ok(rendered.header, `${card.kind} 缺 header`);
    assert.ok(Array.isArray(rendered.elements), `${card.kind} 的 elements 不是数组`);
    assert.ok(rendered.elements.length > 0, `${card.kind} 没有内容`);
  }
});

test("未设预算时给引导而不是空进度条", () => {
  const rendered = renderCard(
    {
      kind: "budget_progress",
      month: "2026-07",
      enabled: false,
      totalBudgetMicros: null,
      usedMicros: "0",
      remainingMicros: null,
      percent: 0,
      categories: [],
    },
    ctx,
  );
  assert.ok(JSON.stringify(rendered).includes("尚未设置预算"));
});

test("lark_md 特殊字符被转义，避免用户备注串版", () => {
  assert.equal(escapeMd("买了*星标*商品"), "买了\\*星标\\*商品");
  assert.equal(escapeMd("正常备注"), "正常备注");
});

// ---------------------------------------------------------------- 草稿映射

test("草稿映射只透传存在的字段", () => {
  const input = draftToCreateTransaction({
    type: "expense",
    grossAmountMicros: "35000000",
    occurredOn: "2026-07-20",
    categoryId: "cat-1",
    categoryName: "餐饮",
  });
  assert.deepEqual(input, {
    type: "expense",
    grossAmountMicros: "35000000",
    occurredOn: "2026-07-20",
    categoryId: "cat-1",
  });
  // categoryName 等展示字段不能进建交易入参（DTO 开了 forbidNonWhitelisted）。
  assert.equal("categoryName" in input, false);
});

test("幂等键与 Web 端完全一致", () => {
  assert.equal(aiCardIdempotencyKey("message-1", 2), "ai-card-message-1-2");
});

// ---------------------------------------------------------------- 卡片操作归一化

test("卡片操作归一化支持 context 嵌套与顶层兜底", () => {
  const value = { action: "confirm_draft", messageId: "msg-1", cardIndex: 0 };
  const nested = normalizeCardAction({
    event: {
      operator: { open_id: "ou_a" },
      context: { open_message_id: "om_1", open_chat_id: "oc_1" },
      action: { value },
    },
  });
  assert.equal(nested.openId, "ou_a");
  assert.equal(nested.feishuMessageId, "om_1");
  assert.equal(nested.aiMessageId, "msg-1");

  const flat = normalizeCardAction({
    operator: { open_id: "ou_a" },
    open_message_id: "om_1",
    open_chat_id: "oc_1",
    action: { value },
  });
  assert.equal(flat.feishuMessageId, "om_1");
});

test("卡片操作归一化拒绝非法输入", () => {
  const base = {
    operator: { open_id: "ou_a" },
    open_message_id: "om_1",
    open_chat_id: "oc_1",
  };
  // 未知 action 一律拒绝，防止构造出的按钮触发意料外的分支。
  assert.equal(
    normalizeCardAction({
      ...base,
      action: { value: { action: "drop_table", messageId: "m", cardIndex: 0 } },
    }),
    null,
  );
  assert.equal(
    normalizeCardAction({ ...base, action: { value: { action: "confirm_draft", cardIndex: 0 } } }),
    null,
  );
  assert.equal(
    normalizeCardAction({
      ...base,
      action: { value: { action: "confirm_draft", messageId: "m", cardIndex: -1 } },
    }),
    null,
  );
  assert.equal(normalizeCardAction(null), null);
});

test("cardIndex 经 JSON 往返变成字符串仍能接受", () => {
  const action = normalizeCardAction({
    operator: { open_id: "ou_a" },
    open_message_id: "om_1",
    open_chat_id: "oc_1",
    action: { value: { action: "confirm_draft", messageId: "m", cardIndex: "2" } },
  });
  assert.equal(action.cardIndex, 2);
});

test("终态草稿卡渲染出的仍是无按钮卡片（回调响应据此替换原卡）", () => {
  // 回归护栏：卡片按钮的更新必须靠回调响应把新卡带回去。
  // 若响应为空，飞书只结束 loading、把卡片恢复原样，按钮又变成可点击。
  // 这里锁住「确认后渲染结果无按钮」，配合 service 返回 { toast, card } 才构成完整链路。
  const confirmed = renderCard(draftCard({ status: "confirmed" }), ctx);
  assert.equal(findButtons(confirmed).length, 0);
  assert.ok(JSON.stringify(confirmed).includes("已记账"));
});
