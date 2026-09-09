import assert from "node:assert/strict";
import test from "node:test";
import { AiService } from "../dist/modules/ai/ai.service.js";
import { yuanToMicros } from "../dist/modules/ai/ai-money.js";
import {
  isTrendRequested,
  isValidDateKey,
  isValidMonthKey,
} from "../dist/modules/ai/ai-validation.js";
import {
  LlmClient,
  normalizeBaseUrl,
  resolveLlmProtocol,
  shouldDisableThinking,
} from "../dist/modules/ai/llm-client.js";
import { periodSeriesBuckets } from "../dist/modules/stats/stats.service.js";
import { WebSearchClient } from "../dist/modules/ai/web-search.js";
import { todayKey } from "@fin-nest/backend";
import { transactionOrderBy } from "../dist/modules/transactions/transactions.service.js";

test("AI money parsing follows ledger precision", () => {
  assert.equal(yuanToMicros("88.50", 2), 88_500_000n);
  assert.equal(yuanToMicros("88.501", 2), null);
  assert.equal(yuanToMicros("88", 0), 88_000_000n);
  assert.equal(yuanToMicros("88.1", 0), null);
});

test("AI date validation rejects normalized calendar dates", () => {
  assert.equal(isValidDateKey("2024-02-29"), true);
  assert.equal(isValidDateKey("2026-02-29"), false);
  assert.equal(isValidDateKey("2026-02-30"), false);
});

test("AI month validation requires a real calendar month", () => {
  assert.equal(isValidMonthKey("2026-07"), true);
  assert.equal(isValidMonthKey("2026-00"), false);
  assert.equal(isValidMonthKey("2026-13"), false);
});

test("AI stats trend is enabled only by a strict true intent flag", () => {
  assert.equal(isTrendRequested(true), true);
  assert.equal(isTrendRequested(false), false);
  assert.equal(isTrendRequested(undefined), false);
  assert.equal(isTrendRequested("true"), false);
});

test("AI disables thinking for DeepSeek tool-calling endpoints", () => {
  assert.equal(shouldDisableThinking("https://api.deepseek.com", "deepseek-v4-flash"), true);
  assert.equal(shouldDisableThinking("https://proxy.example.com/v1", "deepseek-v4-pro"), true);
  assert.equal(shouldDisableThinking("https://api.openai.com/v1", "gpt-5.1"), false);
});

test("DeepSeek tool requests require a tool and preserve hidden reasoning metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "hidden reasoning",
              tool_calls: [],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const client = new LlmClient("https://api.deepseek.com", "test-key", "deepseek-v4-flash");
    const reply = await client.chat(
      [{ role: "user", content: "记一笔 10 元午饭" }],
      [
        {
          type: "function",
          function: {
            name: "draft_transaction",
            description: "生成草稿",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      { toolChoice: "required" },
    );
    assert.equal(requestBody.tool_choice, "required");
    assert.deepEqual(requestBody.thinking, { type: "disabled" });
    assert.equal(reply.reasoningContent, "hidden reasoning");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sseStream(events) {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  return new Response(new Blob(body).stream(), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sseChunks(payloads) {
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`);
  return new Response(new Blob([...body, "data: [DONE]\n\n"]).stream(), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const CHAT_TOOL = {
  type: "function",
  function: {
    name: "draft_transaction",
    description: "生成草稿",
    parameters: { type: "object", properties: { amount: { type: "string" } } },
  },
};

test("chat streaming accumulates text deltas, split tool names and arguments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseChunks([
      { choices: [{ delta: { reasoning_content: "想一想" } }] },
      { choices: [{ delta: { content: "好" } }] },
      { choices: [{ delta: { content: "的" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_abc", function: { name: "draft_", arguments: "" } },
              ],
            },
          },
        ],
      },
      // 函数名分片续传：拼接而不是覆盖，否则工具名会退化成最后一片。
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "transaction" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"amo' } }] } }] },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'unt":"10"}' } }] } }],
      },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 6 } },
    ]);
  try {
    const client = new LlmClient("https://api.deepseek.com/v1", "test-key", "deepseek-chat");
    const deltas = [];
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [CHAT_TOOL],
      (text) => deltas.push(text),
    );
    assert.deepEqual(deltas, ["好", "的"]);
    assert.equal(reply.content, "好的");
    assert.equal(reply.reasoningContent, "想一想");
    assert.deepEqual(reply.toolCalls, [
      {
        id: "call_abc",
        type: "function",
        function: { name: "draft_transaction", arguments: '{"amount":"10"}' },
      },
    ]);
    assert.deepEqual(reply.usage, { promptTokens: 5, completionTokens: 6 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat streaming keeps a repeated full tool name intact", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseChunks([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  function: { name: "draft_transaction", arguments: "" },
                },
              ],
            },
          },
        ],
      },
      // 部分上游每片都重复完整函数名；此时不能再拼，否则变成 draft_transactiondraft_transaction。
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { name: "draft_transaction" } }] } },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
    ]);
  try {
    const client = new LlmClient("https://api.deepseek.com/v1", "test-key", "deepseek-chat");
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [CHAT_TOOL],
      () => {},
    );
    assert.equal(reply.toolCalls[0].function.name, "draft_transaction");
    assert.equal(reply.toolCalls[0].function.arguments, "{}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat streaming keeps parallel tool calls separated by index", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseChunks([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: "call_2", function: { name: "get_budget_progress" } },
                { index: 0, id: "call_1", function: { name: "get_account_balances" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"b":1}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] },
    ]);
  try {
    const client = new LlmClient("https://api.deepseek.com/v1", "test-key", "deepseek-chat");
    const reply = await client.chatStream(
      [{ role: "user", content: "看看余额和预算" }],
      [CHAT_TOOL],
      () => {},
    );
    // 结果按 index 升序，与分片到达顺序无关。
    assert.deepEqual(
      reply.toolCalls.map((call) => [call.id, call.function.name, call.function.arguments]),
      [
        ["call_1", "get_account_balances", '{"a":1}'],
        ["call_2", "get_budget_progress", '{"b":1}'],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI base url normalization strips either full endpoint", () => {
  assert.equal(normalizeBaseUrl("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1");
  assert.equal(
    normalizeBaseUrl("https://api.deepseek.com/v1/chat/completions"),
    "https://api.deepseek.com/v1",
  );
  assert.equal(
    normalizeBaseUrl("https://gw.example.com/v1/responses"),
    "https://gw.example.com/v1",
  );
});

test("AI protocol falls back to the base url shape and honours explicit config", () => {
  assert.equal(resolveLlmProtocol("https://api.deepseek.com/v1"), "chat");
  assert.equal(resolveLlmProtocol("https://gw.example.com/v1/responses"), "responses");
  assert.equal(resolveLlmProtocol("https://gw.example.com/v1/responses/"), "responses");
  assert.equal(resolveLlmProtocol("https://gw.example.com/v1", "responses"), "responses");
  assert.equal(resolveLlmProtocol("https://gw.example.com/v1/responses", "chat"), "chat");
});

const RESPONSES_TOOL = {
  type: "function",
  function: {
    name: "draft_transaction",
    description: "生成草稿",
    parameters: { type: "object", properties: { amount: { type: "string" } } },
  },
};

test("Responses protocol flattens chat messages into instructions and input items", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "hidden reasoning" }] },
          { type: "message", content: [{ type: "output_text", text: "好的" }] },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_abc",
            name: "draft_transaction",
            arguments: '{"amount":"10"}',
          },
        ],
        usage: { input_tokens: 11, output_tokens: 22 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1/responses",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    const reply = await client.chat(
      [
        { role: "system", content: "系统提示" },
        { role: "user", content: "记一笔 10 元午饭" },
        {
          role: "assistant",
          content: "稍等",
          tool_calls: [
            {
              id: "call_prev",
              type: "function",
              function: { name: "draft_transaction", arguments: "{}" },
            },
          ],
          reasoning_content: "上一轮的思考",
        },
        { role: "tool", tool_call_id: "call_prev", content: '{"ok":true}' },
      ],
      [RESPONSES_TOOL],
      { toolChoice: "required" },
    );

    // 端点只拼一次，且 base url 里已有的 /responses 被归一化掉。
    assert.equal(requestUrl, "https://gw.example.com/v1/responses");
    assert.equal(requestBody.instructions, "系统提示");
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.temperature, undefined);
    assert.equal(requestBody.tool_choice, "required");
    assert.deepEqual(requestBody.tools[0], {
      type: "function",
      name: "draft_transaction",
      description: "生成草稿",
      parameters: { type: "object", properties: { amount: { type: "string" } } },
      strict: false,
    });
    assert.deepEqual(requestBody.input, [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "记一笔 10 元午饭" }],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "稍等" }] },
      {
        type: "function_call",
        call_id: "call_prev",
        name: "draft_transaction",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call_prev", output: '{"ok":true}' },
    ]);

    assert.equal(reply.content, "好的");
    assert.equal(reply.reasoningContent, "hidden reasoning");
    // 工具调用 id 取 call_id，续轮 function_call_output 才对得上。
    assert.deepEqual(reply.toolCalls, [
      {
        id: "call_abc",
        type: "function",
        function: { name: "draft_transaction", arguments: '{"amount":"10"}' },
      },
    ]);
    assert.deepEqual(reply.usage, { promptTokens: 11, completionTokens: 22 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses streaming accumulates text deltas and tool call arguments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseStream([
      { type: "response.reasoning_summary_text.delta", delta: "想一想" },
      { type: "response.output_text.delta", output_index: 0, delta: "好" },
      { type: "response.output_text.delta", output_index: 0, delta: "的" },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", call_id: "call_abc", name: "draft_transaction" },
      },
      { type: "response.function_call_arguments.delta", output_index: 1, delta: '{"amo' },
      { type: "response.function_call_arguments.delta", output_index: 1, delta: 'unt":"10"}' },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 5, output_tokens: 6 } },
      },
    ]);
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    const deltas = [];
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [RESPONSES_TOOL],
      (text) => deltas.push(text),
    );
    assert.deepEqual(deltas, ["好", "的"]);
    assert.equal(reply.content, "好的");
    assert.equal(reply.reasoningContent, "想一想");
    assert.deepEqual(reply.toolCalls, [
      {
        id: "call_abc",
        type: "function",
        function: { name: "draft_transaction", arguments: '{"amount":"10"}' },
      },
    ]);
    assert.deepEqual(reply.usage, { promptTokens: 5, completionTokens: 6 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses streaming treats added-frame arguments as a seed, not a prefix", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        // 少数网关在建槽位时就塞了参数，随后仍然把完整参数逐片重发一遍。
        item: {
          type: "function_call",
          call_id: "call_abc",
          name: "draft_transaction",
          arguments: "{}",
        },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"amo' },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: 'unt":"10"}' },
      { type: "response.completed", response: {} },
    ]);
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [RESPONSES_TOOL],
      () => {},
    );
    assert.equal(reply.toolCalls[0].function.arguments, '{"amount":"10"}');
    assert.deepEqual(JSON.parse(reply.toolCalls[0].function.arguments), { amount: "10" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses streaming keeps added-frame arguments when no increment follows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          call_id: "call_abc",
          name: "draft_transaction",
          arguments: '{"amount":"10"}',
        },
      },
      { type: "response.completed", response: {} },
    ]);
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [RESPONSES_TOOL],
      () => {},
    );
    assert.equal(reply.toolCalls[0].function.arguments, '{"amount":"10"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses streaming falls back to the completed frame when no increments arrive", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseStream([
      {
        type: "response.completed",
        response: {
          output: [
            { type: "message", content: [{ type: "output_text", text: "一次性返回" }] },
            {
              type: "function_call",
              call_id: "call_xyz",
              name: "draft_transaction",
              arguments: "{}",
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      },
    ]);
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    const deltas = [];
    const reply = await client.chatStream(
      [{ role: "user", content: "记一笔" }],
      [RESPONSES_TOOL],
      (text) => deltas.push(text),
    );
    // 补发增量，保证流式所见与最终持久化的正文一致。
    assert.deepEqual(deltas, ["一次性返回"]);
    assert.equal(reply.content, "一次性返回");
    assert.equal(reply.toolCalls[0].id, "call_xyz");
    assert.deepEqual(reply.usage, { promptTokens: 1, completionTokens: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses streaming surfaces upstream error events instead of a generic stream abort", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseStream([{ type: "response.failed", response: { error: { message: "rate limited" } } }]);
  try {
    const client = new LlmClient(
      "https://gw.example.com/v1",
      "test-key",
      "gpt-5.6-luna",
      "responses",
    );
    await assert.rejects(
      client.chatStream([{ role: "user", content: "记一笔" }], [RESPONSES_TOOL], () => {}),
      /rate limited/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI stats trend chooses a readable granularity for each span", () => {
  assert.equal(periodSeriesBuckets("2026-07-01", "2026-07-31").granularity, "day");
  assert.equal(periodSeriesBuckets("2026-04-01", "2026-07-01").granularity, "week");
  assert.equal(periodSeriesBuckets("2025-08-01", "2026-07-31").granularity, "month");
});

test("AI yearly stats trend returns twelve ordered monthly points", () => {
  const result = periodSeriesBuckets("2025-08-01", "2026-07-31");
  assert.equal(result.buckets.length, 12);
  assert.deepEqual(
    [result.buckets[0], result.buckets.at(-1)],
    [
      { key: "2025-08", label: "2025/8" },
      { key: "2026-07", label: "2026/7" },
    ],
  );
});

test("transaction query supports both date fields and directions", () => {
  assert.deepEqual(transactionOrderBy({}), [
    { occurredOn: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.deepEqual(transactionOrderBy({ sortBy: "occurredOn", sortOrder: "asc" }), [
    { occurredOn: "asc" },
    { createdAt: "asc" },
    { id: "asc" },
  ]);
  assert.deepEqual(transactionOrderBy({ sortBy: "createdAt", sortOrder: "asc" }), [
    { createdAt: "asc" },
    { id: "asc" },
  ]);
  assert.deepEqual(transactionOrderBy({ sortBy: "createdAt", sortOrder: "desc" }), [
    { createdAt: "desc" },
    { id: "desc" },
  ]);
});

test("AI transaction query forwards the selected creator as createdBy", async () => {
  const queries = [];
  const service = Object.create(AiService.prototype);
  service.transactions = {
    list: async (_ledgerId, _userId, query) => {
      queries.push(query);
      return [
        {
          occurredOn: new Date("2026-07-01T00:00:00.000Z"),
          type: "expense",
          effectiveAmountMicros: 1_000_000n,
          categoryId: null,
          subcategoryId: null,
          categorySnapshot: null,
          personId: null,
          personSnapshot: null,
          createdBy: "creator-1",
          note: null,
        },
      ];
    },
    summary: async (_ledgerId, _userId, query) => {
      queries.push(query);
      return { count: 1, expenseMicros: 1_000_000n, incomeMicros: 0n };
    },
  };
  const context = {
    ledgerId: "ledger-1",
    userId: "user-1",
    currency: "CNY",
    amountDecimalPlaces: 2,
    categories: [],
    accounts: [],
    people: [],
    transactionCreators: [{ userId: "creator-1", name: "菜菜" }],
    quickTemplates: [],
    acctRequired: false,
    personRequired: false,
    outstandingDrafts: [],
  };
  const cards = [];

  const result = await service.runQueryTool(
    {
      createdByUserId: "creator-1",
      dateFrom: "2026-06-21",
      dateTo: "2026-07-20",
      sortBy: "createdAt",
      sortOrder: "asc",
    },
    context,
    cards,
  );

  assert.equal(result.ok, true);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.createdBy === "creator-1"));
  assert.ok(queries.every((query) => query.sortBy === "createdAt" && query.sortOrder === "asc"));
  assert.equal(cards[0].rows[0].creatorName, "菜菜");

  const invalid = await service.runQueryTool({ createdByUserId: "unknown-creator" }, context, []);
  assert.deepEqual(invalid, {
    ok: false,
    error: "createdByUserId 不在账本记账人列表中",
  });
});

test("AI transaction query gives the card every row but the model only a sample", async () => {
  const service = Object.create(AiService.prototype);
  const rows = Array.from({ length: 50 }, (_, index) => ({
    occurredOn: new Date("2026-07-01T00:00:00.000Z"),
    type: "expense",
    effectiveAmountMicros: BigInt(index + 1) * 1_000_000n,
    categoryId: null,
    subcategoryId: null,
    categorySnapshot: null,
    personId: null,
    personSnapshot: null,
    createdBy: "creator-1",
    note: `第${index + 1}笔`,
  }));
  service.transactions = {
    list: async () => rows,
    summary: async () => ({ count: 120, expenseMicros: 1_275_000_000n, incomeMicros: 0n }),
  };
  const context = {
    ledgerId: "ledger-1",
    userId: "user-1",
    currency: "CNY",
    amountDecimalPlaces: 2,
    categories: [],
    accounts: [],
    people: [],
    transactionCreators: [{ userId: "creator-1", name: "菜菜" }],
    quickTemplates: [],
    acctRequired: false,
    personRequired: false,
    outstandingDrafts: [],
  };
  const cards = [];

  const result = await service.runQueryTool({ limit: 50 }, context, cards);

  // 卡片是用户读明细的地方，拿到全部 50 行；模型只需要够转述的样本。
  assert.equal(cards[0].rows.length, 50);
  assert.equal(result.transactions.length, 20);
  assert.equal(result.transactions[0].note, "第1笔");
  assert.equal(result.transactions.at(-1).note, "第20笔");
  // 总数仍如实告知，模型不会把样本当成全部。
  assert.equal(result.count, 120);
  assert.ok(result.transactionsNote.includes("共 120 笔"));
  assert.ok(result.transactionsNote.includes("仅列前 20 笔"));
});

// --- 联网搜索 -----------------------------------------------------------------

test("web search stays disabled until its provider is fully configured", () => {
  assert.equal(WebSearchClient.fromConfig({ SEARCH_MAX_RESULTS: 5 }).client, null);
  // 配了一半是最容易踩的坑：工具静默消失，所以要给出可读的原因。
  const halfBocha = WebSearchClient.fromConfig({
    SEARCH_PROVIDER: "bocha",
    SEARCH_MAX_RESULTS: 5,
  });
  assert.equal(halfBocha.client, null);
  assert.match(halfBocha.reason, /SEARCH_API_KEY/);
  const halfSearxng = WebSearchClient.fromConfig({
    SEARCH_PROVIDER: "searxng",
    SEARCH_MAX_RESULTS: 5,
  });
  assert.equal(halfSearxng.client, null);
  assert.match(halfSearxng.reason, /SEARCH_BASE_URL/);
  // searxng 自建实例不需要 key。
  assert.ok(
    WebSearchClient.fromConfig({
      SEARCH_PROVIDER: "searxng",
      SEARCH_BASE_URL: "http://searxng:8080",
      SEARCH_MAX_RESULTS: 5,
    }).client,
  );
});

test("bocha search results are normalized, sanitized and capped", async () => {
  const { client } = WebSearchClient.fromConfig({
    SEARCH_PROVIDER: "bocha",
    SEARCH_API_KEY: "sk-test",
    SEARCH_MAX_RESULTS: 2,
  });
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestInit;
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          webPages: {
            value: [
              {
                name: "iPhone 17 Pro 售价",
                url: "https://example.com/a",
                // 控制字符换成空格：搜索结果是外部文本，不能让它伪造对话结构。
                summary: "官网\n5999 元 起",
                siteName: "example.com",
                datePublished: "2026-09-01T00:00:00Z",
              },
              // 非 http(s) 链接直接丢弃，不能递给模型再转述给用户。
              { name: "钓鱼", url: "javascript:alert(1)", summary: "x" },
              { name: "第三条", url: "https://example.com/c", summary: "c" },
              { name: "第四条", url: "https://example.com/d", summary: "d" },
            ],
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const results = await client.search("iPhone 17 Pro 售价");
    assert.equal(requestUrl, "https://api.bochaai.com/v1/web-search");
    assert.equal(requestInit.headers.authorization, "Bearer sk-test");
    assert.equal(JSON.parse(requestInit.body).count, 2);
    // SEARCH_MAX_RESULTS 是硬上限：结果多也只回这么多，token 成本可控。
    assert.equal(results.length, 2);
    assert.equal(results[0].url, "https://example.com/a");
    assert.equal(results[0].snippet, "官网 5999 元 起");
    assert.equal(results[0].publishedAt, "2026-09-01");
    assert.equal(results[1].url, "https://example.com/c");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searxng search asks its own instance for json", async () => {
  const { client } = WebSearchClient.fromConfig({
    SEARCH_PROVIDER: "searxng",
    // 只填实例根地址是最常见的写法，要能自己补出 /search。
    SEARCH_BASE_URL: "http://searxng:8080/",
    SEARCH_MAX_RESULTS: 5,
  });
  const originalFetch = globalThis.fetch;
  let requestUrl;
  globalThis.fetch = async (url) => {
    requestUrl = url;
    return new Response(
      JSON.stringify({ results: [{ title: "t", url: "https://e.com", content: "c" }] }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const results = await client.search("小米 17 价格");
    const parsed = new URL(requestUrl);
    assert.equal(parsed.origin + parsed.pathname, "http://searxng:8080/search");
    assert.equal(parsed.searchParams.get("format"), "json");
    assert.equal(parsed.searchParams.get("q"), "小米 17 价格");
    assert.equal(results[0].snippet, "c");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search tool reports honestly when the deployment has no provider", async () => {
  const service = Object.create(AiService.prototype);
  service.search = null;
  const result = await service.runWebSearchTool({ query: "最新款手机" });
  assert.equal(result.ok, false);
  assert.match(result.error, /未配置联网搜索/);
});

// --- 花钱决策分析 -------------------------------------------------------------

function purchaseAnalysisService() {
  const service = Object.create(AiService.prototype);
  // 物品的 purchase_date 是 date-only 列（UTC 零点），已用天数因此是整数天：
  // 用 Date.now() 造样本会带上当天时刻，把 400 天算成 399 天。
  const daysAgo = (days) => new Date(Date.parse(`${todayKey()}T00:00:00.000Z`) - days * 86_400_000);
  service.assets = {
    listItems: async () => [
      {
        id: "item-1",
        name: "iPhone 13",
        typeId: "type-1",
        purchasePriceMicros: 4_000_000_000n,
        consumablesMicros: "500000000",
        purchaseDate: daysAgo(400),
        expectedYears: 3,
        scrappedAt: null,
        scrapDate: null,
        sellPriceMicros: null,
        note: null,
      },
      { id: "item-2", name: "洗碗机", typeId: null, purchasePriceMicros: 3_000_000_000n },
    ],
    listItemTypes: async () => [{ id: "type-1", name: "手机" }],
    listSubscriptions: async () => [
      { terminatedAt: null, priceMicros: 30_000_000n, billingCycle: "monthly" },
      { terminatedAt: null, priceMicros: 1_200_000_000n, billingCycle: "yearly" },
      { terminatedAt: null, priceMicros: 99_000_000n, billingCycle: "custom" },
      { terminatedAt: new Date(), priceMicros: 50_000_000n, billingCycle: "monthly" },
    ],
  };
  service.accounts = {
    list: async () => [
      {
        id: "acc-1",
        type: "savings",
        balanceMicros: 10_000_000_000n,
        includeInNetWorth: true,
        personId: null,
        subAccounts: [],
      },
      {
        id: "acc-2",
        type: "credit",
        balanceMicros: 2_000_000_000n,
        includeInNetWorth: true,
        personId: null,
        subAccounts: [],
      },
    ],
  };
  service.stats = {
    periodSeries: async () => ({
      granularity: "month",
      points: [
        { label: "2026/4", expenseMicros: "3000000000", incomeMicros: "8000000000" },
        { label: "2026/5", expenseMicros: "3000000000", incomeMicros: "8000000000" },
        { label: "2026/6", expenseMicros: "3000000000", incomeMicros: "8000000000" },
        { label: "2026/7", expenseMicros: "3000000000", incomeMicros: "8000000000" },
        { label: "2026/8", expenseMicros: "3000000000", incomeMicros: "8000000000" },
        // 当月未过完，必须排除在月均之外。
        { label: "2026/9", expenseMicros: "500000000", incomeMicros: "0" },
      ],
    }),
  };
  service.plans = {
    getBudgetProgress: async () => ({
      enabled: true,
      month: "2026-09",
      total: {
        budgetMicros: "5000000000",
        usedMicros: "1000000000",
        remainingMicros: "4000000000",
        percent: 20,
      },
      categories: [],
    }),
  };
  service.transactions = {
    list: async () => [
      {
        occurredOn: new Date("2025-08-01T00:00:00.000Z"),
        effectiveAmountMicros: 4_000_000_000n,
        categoryId: "cat-1",
        note: "换手机",
      },
    ],
  };
  return service;
}

const PURCHASE_CONTEXT = {
  ledgerId: "ledger-1",
  userId: "user-1",
  currency: "CNY",
  amountDecimalPlaces: 2,
  categories: [{ id: "cat-1", name: "数码", type: "expense", subcategories: [] }],
  accounts: [],
  people: [],
  transactionCreators: [],
  quickTemplates: [],
  acctRequired: false,
  personRequired: false,
  outstandingDrafts: [],
};

test("purchase analysis aggregates the facts a spending decision needs", async () => {
  const service = purchaseAnalysisService();
  const result = await service.runPurchaseAnalysisTool({ keyword: "手机" }, PURCHASE_CONTEXT);

  assert.equal(result.ok, true);
  // 关键词命中物品类型（"手机"）即算同类旧物，不必名字里带这两个字。
  assert.equal(result.matchedItems.length, 1);
  const [phone] = result.matchedItems;
  assert.equal(phone.name, "iPhone 13");
  assert.equal(phone.usedDays, 400);
  assert.equal(phone.totalCostYuan, "4500");
  // 日均持有成本 =（购入价 + 耗材）/ 已用天数，换与不换最直观的比较口径。
  assert.equal(phone.dailyCostYuan, "11.25");
  assert.equal(phone.usagePercent, 36.5);

  // 月均排除当月（未过完），否则每次都被低估。
  assert.equal(result.spending.avgMonthlyExpenseYuan, "3000");
  assert.equal(result.spending.avgMonthlyIncomeYuan, "8000");
  assert.equal(result.spending.avgMonthlySurplusYuan, "5000");
  assert.equal(result.spending.months.length, 6);

  // 可动用现金只认储蓄账户；信用账户记为负债。
  assert.equal(result.balances.cashYuan, "10000");
  assert.equal(result.balances.totalLiabilitiesYuan, "2000");
  assert.equal(result.balances.netWorthYuan, "8000");

  assert.equal(result.budget.remainingYuan, "4000");
  // 订阅折成月成本：月付 30 + 年付 1200/12；自定义周期折不出来，只报个数。
  assert.equal(result.fixedCommitments.monthlySubscriptionCostYuan, "130");
  assert.equal(result.fixedCommitments.customCycleCount, 1);
  assert.equal(result.fixedCommitments.activeSubscriptions, 3);

  // 档案缺失时的兜底线索：备注里提到关键词的历史支出。
  assert.equal(result.pastPurchases[0].amountYuan, "4000");
  assert.equal(result.pastPurchases[0].category, "数码");
});

test("purchase analysis says archives are empty instead of asserting the user owns nothing", async () => {
  const service = purchaseAnalysisService();
  const result = await service.runPurchaseAnalysisTool(
    { keyword: "投影仪", monthsBack: 3 },
    PURCHASE_CONTEXT,
  );
  assert.equal(result.matchedItems.length, 0);
  assert.match(result.matchedItemsNote, /没有匹配/);
  // monthsBack 下限 6：跨度 ≤120 天时 periodSeries 会退化成周/日桶，拿不到月均。
  assert.equal(result.spending.monthsBack, 6);
});
