import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCardAction } from "../dist/modules/feishu/feishu-card-action.service.js";
import { escapeMd, renderCard, renderMarkdownCard } from "../dist/modules/feishu/feishu-cards.js";
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
import { formatMicros } from "../dist/modules/feishu/feishu-money.js";
import {
  cycleKeyOfOccurrence,
  isEntryReminderConfigured,
  isoWeekday,
  matchesEntryReminderDate,
  earliestSchedule,
  reminderCycleKey,
  scheduleLeadKey,
  scheduleReminderDate,
  sortSchedules,
} from "@fin-nest/backend";

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

function cardElements(card) {
  return card.body?.elements ?? card.elements;
}

test("大模型正文使用 JSON 2.0 Markdown 卡片并保留 Markdown 语法", () => {
  const content = "## 本月小结\n\n- **餐饮**：¥35.00\n- [查看详情](https://example.com)";
  const rendered = renderMarkdownCard(content);
  assert.equal(rendered.schema, "2.0");
  assert.deepEqual(cardElements(rendered), [{ tag: "markdown", content }]);
});

test("待确认草稿卡先显示作废、再显示确认入账按钮", () => {
  const buttons = findButtons(renderCard(draftCard(), ctx));
  assert.equal(buttons.length, 2);
  assert.deepEqual(
    buttons.map((b) => b.value.action),
    ["discard_draft", "confirm_draft"],
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
    const elements = cardElements(rendered);
    assert.ok(Array.isArray(elements), `${card.kind} 的 elements 不是数组`);
    assert.ok(elements.length > 0, `${card.kind} 没有内容`);
  }
});

test("交易明细使用 JSON 2.0 原生表格并展示最多 50 笔", () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({
    occurredOn: "2026-07-20",
    type: "expense",
    effectiveAmountMicros: "1000000",
    categoryName: "很长的分类名称".repeat(20),
    subcategoryName: `二级分类${index + 1}${"很长的二级分类".repeat(20)}`,
    personName: `人员${index + 1}${"很长的人员名称".repeat(20)}`,
    creatorName: `记账人${index + 1}${"很长的记账人名称".repeat(20)}`,
    note: `第${index + 1}笔${"很长的备注".repeat(40)}`,
  }));
  const rendered = renderCard(
    {
      kind: "transactions",
      title: "查询结果",
      count: 51,
      expenseMicros: "51000000",
      incomeMicros: "0",
      rows,
    },
    ctx,
  );
  assert.equal(rendered.schema, "2.0");
  const elements = cardElements(rendered);
  const table = elements.find((element) => element.tag === "table");
  assert.ok(table);
  assert.equal(table.page_size, 10);
  assert.equal(table.rows.length, 50);
  assert.deepEqual(
    table.columns.map((column) => column.display_name),
    ["日期", "类型", "分类", "人员", "记账人", "金额", "备注"],
  );
  for (const column of table.columns) {
    const width = Number.parseInt(column.width, 10);
    assert.ok(width >= 80 && width <= 600, `${column.display_name} 列宽不符合飞书 80px–600px 限制`);
  }
  assert.equal(table.columns[0].width, "120px");
  assert.ok(table.rows[0].category.startsWith("二级分类1"));
  assert.ok(!table.rows[0].category.includes("很长的分类名称"));
  assert.ok(table.rows[0].person.startsWith("人员1"));
  assert.ok(table.rows[0].creator.startsWith("记账人1"));
  const json = JSON.stringify(rendered);
  assert.ok(json.includes("第50笔"));
  assert.ok(json.includes("仅显示前 50 笔，余下 1 笔请到网页端查看"));
  assert.equal(elements.at(-1).tag, "markdown");
  assert.ok(Buffer.byteLength(json, "utf8") < 30 * 1024, "50 行长文本卡片应低于 30 KB");
});

test("统计卡只使用支出分类柱状图，并在有趋势时展示折线图", () => {
  const rendered = renderCard(
    {
      kind: "stats_period",
      title: "近 30 天统计",
      dateFrom: "2026-06-21",
      dateTo: "2026-07-20",
      expenseMicros: "123456789",
      incomeMicros: "80000000",
      expenseCategories: [
        { name: "餐饮", amountMicros: "10050000" },
        { name: "交通", amountMicros: "5000000" },
      ],
      incomeCategories: [{ name: "工资", amountMicros: "80000000" }],
      trend: {
        granularity: "week",
        points: [
          { label: "06-21 ~ 06-27", expenseMicros: "30000000", incomeMicros: "0" },
          { label: "06-28 ~ 07-04", expenseMicros: "45500000", incomeMicros: "80000000" },
        ],
      },
    },
    ctx,
  );

  assert.equal(rendered.schema, "2.0");
  // 收支双边的摘要必须给出差额（收入 − 支出），与 Web 统计卡一致。
  const summary = cardElements(rendered).find((element) => element.tag === "markdown");
  assert.ok(summary.content.includes("**支出** ¥123.46"));
  assert.ok(summary.content.includes("**收入** ¥80.00"));
  assert.ok(summary.content.includes("**差额** -¥43.46"));
  const charts = cardElements(rendered).filter((element) => element.tag === "chart");
  assert.deepEqual(
    charts.map((chart) => chart.chart_spec.type),
    ["bar", "line"],
  );
  assert.deepEqual(
    charts.map((chart) => chart.element_id),
    ["expense_chart", "trend_chart"],
  );
  // 飞书图表的数值轴是线性轴：值必须是 number，字符串画不出正确的柱高/折线。
  assert.equal(charts[0].chart_spec.data.values[0].value, 10.05);
  assert.equal(charts[1].chart_spec.data.values[0].value, 30);
  assert.equal(charts[1].chart_spec.data.values[1].value, 0);
  for (const chart of charts) {
    for (const point of chart.chart_spec.data.values) {
      assert.equal(typeof point.value, "number", "图表数值必须是 number");
      assert.ok(Number.isFinite(point.value), "图表数值不能是 NaN/Infinity");
    }
  }
  assert.equal(JSON.stringify(rendered).includes("income_chart"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(rendered), "utf8") < 30 * 1024);
});

test("direction=expense 的统计卡不出现收入摘要与收入折线", () => {
  const rendered = renderCard(
    {
      kind: "stats_period",
      title: "7 月支出统计",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      direction: "expense",
      expenseMicros: "123456789",
      incomeMicros: "0",
      expenseCategories: [{ name: "餐饮", amountMicros: "10050000" }],
      incomeCategories: [],
      trend: {
        granularity: "week",
        points: [
          { label: "07-01 ~ 07-07", expenseMicros: "30000000", incomeMicros: "0" },
          { label: "07-08 ~ 07-14", expenseMicros: "45500000", incomeMicros: "0" },
        ],
      },
    },
    ctx,
  );
  const elements = cardElements(rendered);
  const summary = elements.find((element) => element.tag === "markdown");
  assert.ok(summary.content.includes("支出"));
  assert.equal(summary.content.includes("收入"), false);
  // 单边统计没有可言的差额，不能凭 0 收入算出一个「差额」。
  assert.equal(summary.content.includes("差额"), false);
  const charts = elements.filter((element) => element.tag === "chart");
  assert.equal(charts[0].chart_spec.title.text, "支出分类");
  assert.ok(charts[1].chart_spec.title.text.startsWith("支出趋势"));
  assert.deepEqual(
    [...new Set(charts[1].chart_spec.data.values.map((point) => point.type))],
    ["支出"],
  );
});

test("direction=income 的统计卡只画收入分类与收入趋势", () => {
  const rendered = renderCard(
    {
      kind: "stats_period",
      title: "7 月收入统计",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      direction: "income",
      expenseMicros: "0",
      incomeMicros: "80000000",
      expenseCategories: [],
      incomeCategories: [{ name: "工资", amountMicros: "80000000" }],
      trend: {
        granularity: "week",
        points: [
          { label: "07-01 ~ 07-07", expenseMicros: "0", incomeMicros: "80000000" },
          { label: "07-08 ~ 07-14", expenseMicros: "0", incomeMicros: "0" },
        ],
      },
    },
    ctx,
  );
  const elements = cardElements(rendered);
  const summary = elements.find((element) => element.tag === "markdown");
  assert.ok(summary.content.includes("收入"));
  assert.equal(summary.content.includes("支出"), false);
  const charts = elements.filter((element) => element.tag === "chart");
  assert.equal(charts[0].chart_spec.title.text, "收入分类");
  assert.equal(charts[0].chart_spec.data.values[0].type, "工资");
  assert.ok(charts[1].chart_spec.title.text.startsWith("收入趋势"));
  assert.deepEqual(
    [...new Set(charts[1].chart_spec.data.values.map((point) => point.type))],
    ["收入"],
  );
});

test("统计卡没有分类和趋势时保留摘要与无数据提示", () => {
  const rendered = renderCard(
    {
      kind: "stats_period",
      title: "空统计",
      dateFrom: "2026-07-20",
      dateTo: "2026-07-20",
      expenseMicros: "0",
      incomeMicros: "0",
      expenseCategories: [],
      incomeCategories: [],
    },
    ctx,
  );
  const elements = cardElements(rendered);
  assert.equal(
    elements.some((element) => element.tag === "chart"),
    false,
  );
  assert.ok(JSON.stringify(rendered).includes("暂无可绘制的分类或趋势数据"));
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

// ---------------------------------------------------------------- 多档提醒

test("档位按提前量从大到小排，最早那一档进镜像列", () => {
  const tiers = [
    { leadValue: 1, leadUnit: "day" },
    { leadValue: 1, leadUnit: "month" },
    { leadValue: 2, leadUnit: "week" },
  ];
  assert.deepEqual(
    sortSchedules(tiers).map((tier) => `${tier.leadValue}${tier.leadUnit}`),
    ["1month", "2week", "1day"],
  );
  assert.deepEqual(earliestSchedule(tiers), { leadValue: 1, leadUnit: "month" });
  assert.equal(earliestSchedule([]), null);
});

test("每档各自算提醒日与档位键", () => {
  const due = new Date("2026-08-22T00:00:00Z");
  assert.equal(
    scheduleReminderDate(due, { leadValue: 30, leadUnit: "day" }).toISOString().slice(0, 10),
    "2026-07-23",
  );
  assert.equal(
    scheduleReminderDate(due, { leadValue: 1, leadUnit: "week" }).toISOString().slice(0, 10),
    "2026-08-15",
  );
  assert.equal(scheduleReminderDate(null, { leadValue: 1, leadUnit: "day" }), null);
  // 少了档位键，两档会算出同一个 dedupeKey，后一档被唯一约束静默吞掉。
  assert.notEqual(
    scheduleLeadKey({ leadValue: 7, leadUnit: "day" }),
    scheduleLeadKey({ leadValue: 1, leadUnit: "day" }),
  );
});

test("同一轮提醒的各档共享周期键：任一档被处理，后续档据此不再推送", () => {
  const cycle = reminderCycleKey("subscription", "sub-1", "2026-08-22");
  const first = `${cycle}:${scheduleLeadKey({ leadValue: 30, leadUnit: "day" })}`;
  const second = `${cycle}:${scheduleLeadKey({ leadValue: 7, leadUnit: "day" })}`;
  assert.notEqual(first, second);
  assert.equal(cycleKeyOfOccurrence(first), cycle);
  assert.equal(cycleKeyOfOccurrence(second), cycle);
  // 基准日变了（网页端续费）就是另一轮，不会被上一轮的「已处理」抑制。
  assert.notEqual(
    cycleKeyOfOccurrence(first),
    reminderCycleKey("subscription", "sub-1", "2026-09-22"),
  );
});

// ---------------------------------------------------------------- 记账提醒周期

test("记账提醒：每天恒命中，每周看星期", () => {
  const monday = new Date("2026-07-20T00:00:00Z");
  const sunday = new Date("2026-07-26T00:00:00Z");
  assert.equal(isoWeekday(monday), 1);
  assert.equal(isoWeekday(sunday), 7);

  const daily = { frequency: "daily", weekdays: [], monthDays: [] };
  assert.equal(matchesEntryReminderDate(daily, monday), true);

  const weekly = { frequency: "weekly", weekdays: [1, 5], monthDays: [] };
  assert.equal(matchesEntryReminderDate(weekly, monday), true);
  assert.equal(matchesEntryReminderDate(weekly, sunday), false);
});

test("记账提醒：每月选中的日号当月不存在时，落到当月最后一天", () => {
  const monthly = { frequency: "monthly", weekdays: [], monthDays: [1, 31] };
  assert.equal(matchesEntryReminderDate(monthly, new Date("2026-02-01T00:00:00Z")), true);
  assert.equal(matchesEntryReminderDate(monthly, new Date("2026-02-27T00:00:00Z")), false);
  // 2 月没有 31 号 → 28 号（当月最后一天）补发。
  assert.equal(matchesEntryReminderDate(monthly, new Date("2026-02-28T00:00:00Z")), true);
  // 有 31 号的月份就按 31 号发，30 号不发。
  assert.equal(matchesEntryReminderDate(monthly, new Date("2026-07-30T00:00:00Z")), false);
  assert.equal(matchesEntryReminderDate(monthly, new Date("2026-07-31T00:00:00Z")), true);
  // 选中的日号都在当月存在时，最后一天不该被顺带触发。
  const early = { frequency: "monthly", weekdays: [], monthDays: [5] };
  assert.equal(matchesEntryReminderDate(early, new Date("2026-02-28T00:00:00Z")), false);
});

test("记账提醒：每周不选星期、每月不选日号 = 永远不触发，配置校验拦住", () => {
  assert.equal(
    isEntryReminderConfigured({ frequency: "daily", weekdays: [], monthDays: [] }),
    true,
  );
  assert.equal(
    isEntryReminderConfigured({ frequency: "weekly", weekdays: [], monthDays: [] }),
    false,
  );
  assert.equal(
    isEntryReminderConfigured({ frequency: "monthly", weekdays: [], monthDays: [] }),
    false,
  );
  assert.equal(
    isEntryReminderConfigured({ frequency: "monthly", weekdays: [], monthDays: [1] }),
    true,
  );
});
