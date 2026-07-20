import assert from "node:assert/strict";
import test from "node:test";
import { AiService } from "../dist/modules/ai/ai.service.js";
import { yuanToMicros } from "../dist/modules/ai/ai-money.js";
import {
  isTrendRequested,
  isValidDateKey,
  isValidMonthKey,
} from "../dist/modules/ai/ai-validation.js";
import { LlmClient, shouldDisableThinking } from "../dist/modules/ai/llm-client.js";
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
