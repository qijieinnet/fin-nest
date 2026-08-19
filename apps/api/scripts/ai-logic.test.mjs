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
