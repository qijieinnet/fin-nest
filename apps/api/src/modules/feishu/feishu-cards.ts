import type { AiCard, AiDraftFields } from "../ai/ai-cards";
import { microsToYuan } from "../ai/ai-money";
import { formatMicros, progressBar } from "./feishu-money";

/**
 * AiCard → 飞书交互卡片 JSON。纯函数，可离线单测。
 *
 * 约束：
 * - 金额一律走 `formatMicros`（bigint），**禁止 number 参与换算**（硬规则 1）；
 * - 按钮 value **只放 messageId + cardIndex**。userId / ledgerId 是客户端可篡改的输入，
 *   服务端一律从库里反查（见 docs/FEISHU_BOT_PLAN.md §8）；
 * - 图表数值走 `chartValue`：micros → 主单位的换算全程 bigint，只在交给 VChart 的
 *   最后一步转 number。飞书图表的数值轴是线性轴，喂字符串画不出正确的柱高/折线。
 *   这不违反硬规则 1——转换发生在渲染边界，不参与任何金额计算（与前端 AiCards 同做法）。
 */

export type FeishuCardBody = Record<string, unknown>;

export type CardRenderContext = {
  /** 账本小数位与币种，决定金额显示形态。 */
  decimalPlaces: number;
  currency?: string | null;
  /** 所属 AiMessage 与卡片下标，用于按钮回调定位。 */
  messageId: string;
  cardIndex: number;
};

export type DraftActionValue = {
  action: "confirm_draft" | "discard_draft";
  messageId: string;
  cardIndex: number;
};

/** 分类、账户等摘要列表最多展示的行数。 */
const MAX_ROWS = 10;

/** 交易明细卡最多展示 50 笔，与 `query_transactions` 的查询上限一致。 */
const MAX_TRANSACTION_ROWS = 50;

/**
 * 全角空格（U+3000）。飞书卡片没有表格布局，用它在等宽的中文文本里拉开列间距，
 * 比普通空格对齐得整齐。写成转义而非字面量，否则会触发 `no-irregular-whitespace`。
 */
const COLUMN_GAP = "\u3000";

const TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
};

export function renderCard(card: AiCard, ctx: CardRenderContext): FeishuCardBody {
  switch (card.kind) {
    case "transaction_draft":
      return renderDraftCard(card, ctx);
    case "transactions":
      return renderTransactionsCard(card, ctx);
    case "stats_period":
    case "stats_month":
      return renderStatsCard(card, ctx);
    case "account_balances":
      return renderAccountBalancesCard(card, ctx);
    case "budget_progress":
      return renderBudgetCard(card, ctx);
  }
}

/** 大模型正文使用 JSON 2.0 Markdown 卡片发送，普通 text 消息不会解析 Markdown。 */
export function renderMarkdownCard(content: string): FeishuCardBody {
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    body: {
      elements: [{ tag: "markdown", content }],
    },
  };
}

// ------------------------------------------------------------------ 记账草稿

function renderDraftCard(
  card: Extract<AiCard, { kind: "transaction_draft" }>,
  ctx: CardRenderContext,
): FeishuCardBody {
  const { draft, status } = card;
  const elements: FeishuCardBody[] = [fieldGrid(draftFields(draft, ctx))];

  if (draft.note) {
    elements.push(divText(`**备注**\n${escapeMd(draft.note)}`));
  }

  if (status === "proposed" && !card.confirmationBlockedReason) {
    elements.push({
      tag: "action",
      actions: [
        button("作废", "default", {
          action: "discard_draft",
          messageId: ctx.messageId,
          cardIndex: ctx.cardIndex,
        }),
        button("确认入账", "primary", {
          action: "confirm_draft",
          messageId: ctx.messageId,
          cardIndex: ctx.cardIndex,
        }),
      ],
    });
  } else {
    elements.push(note(draftStatusNote(card)));
  }

  return cardBody({
    title: `记一笔 · ${TYPE_LABELS[draft.type] ?? draft.type}`,
    template: status === "confirmed" ? "green" : status === "superseded" ? "grey" : "blue",
    elements,
  });
}

function draftStatusNote(card: Extract<AiCard, { kind: "transaction_draft" }>): string {
  if (card.confirmationBlockedReason) return `⚠️ 无法确认：${card.confirmationBlockedReason}`;
  if (card.status === "confirmed") return "✅ 已记账";
  return "已作废";
}

function draftFields(draft: AiDraftFields, ctx: CardRenderContext): string[] {
  const fields = [
    `**金额**\n${formatMicros(draft.grossAmountMicros, ctx.decimalPlaces, draft.currency ?? ctx.currency)}`,
    `**日期**\n${draft.occurredOn}`,
  ];

  if (draft.type === "transfer") {
    fields.push(`**转出**\n${accountLabel(draft.fromAccountName, draft.fromSubAccountName)}`);
    fields.push(`**转入**\n${accountLabel(draft.toAccountName, draft.toSubAccountName)}`);
  } else {
    fields.push(`**分类**\n${categoryLabel(draft.categoryName, draft.subcategoryName)}`);
    fields.push(`**账户**\n${accountLabel(draft.accountName, draft.subAccountName)}`);
  }

  if (draft.personName) fields.push(`**人员**\n${escapeMd(draft.personName)}`);
  return fields;
}

function categoryLabel(category?: string, subcategory?: string): string {
  if (!category) return "未指定";
  return subcategory ? `${escapeMd(category)} / ${escapeMd(subcategory)}` : escapeMd(category);
}

function accountLabel(account?: string, subAccount?: string): string {
  if (!account) return "未指定";
  return subAccount ? `${escapeMd(account)} / ${escapeMd(subAccount)}` : escapeMd(account);
}

// ------------------------------------------------------------------ 交易明细

function renderTransactionsCard(
  card: Extract<AiCard, { kind: "transactions" }>,
  ctx: CardRenderContext,
): FeishuCardBody {
  const currency = card.currency ?? ctx.currency;
  const elements: FeishuCardBody[] = [
    {
      tag: "markdown",
      content:
        `**支出** ${formatMicros(card.expenseMicros, ctx.decimalPlaces, currency)}` +
        `${COLUMN_GAP}${COLUMN_GAP}**收入** ${formatMicros(card.incomeMicros, ctx.decimalPlaces, currency)}`,
    },
  ];

  const rows = card.rows.slice(0, MAX_TRANSACTION_ROWS);
  if (rows.length === 0) {
    elements.push({ tag: "markdown", content: "没有符合条件的记录。" });
  } else {
    elements.push({
      tag: "table",
      page_size: 10,
      row_height: "low",
      freeze_first_column: true,
      header_style: {
        text_align: "left",
        text_size: "normal",
        background_style: "grey",
        text_color: "default",
        bold: true,
        lines: 1,
      },
      columns: [
        { name: "date", display_name: "日期", data_type: "text", width: "120px" },
        { name: "type", display_name: "类型", data_type: "text", width: "80px" },
        { name: "category", display_name: "分类", data_type: "text", width: "100px" },
        { name: "person", display_name: "人员", data_type: "text", width: "100px" },
        { name: "creator", display_name: "记账人", data_type: "text", width: "100px" },
        {
          name: "amount",
          display_name: "金额",
          data_type: "text",
          width: "110px",
          horizontal_align: "right",
        },
        { name: "note", display_name: "备注", data_type: "text", width: "160px" },
      ],
      rows: rows.map((row) => ({
        date: row.occurredOn,
        type: TYPE_LABELS[row.type] ?? row.type,
        category: truncateTableText(
          row.subcategoryName ?? row.categoryName ?? (row.type === "transfer" ? "转账" : "未分类"),
          32,
        ),
        person: row.personName ? truncateTableText(row.personName, 24) : "—",
        creator: row.creatorName ? truncateTableText(row.creatorName, 24) : "—",
        amount: formatMicros(row.effectiveAmountMicros, ctx.decimalPlaces, currency),
        note: row.note ? truncateTableText(row.note, 48) : "—",
      })),
    });
  }

  // `rows` 在 AiService 中已经截成最多 50 笔，必须用汇总 count 判断是否还有未展示记录。
  if (card.count > rows.length) {
    elements.push({
      tag: "markdown",
      content: `*仅显示前 ${rows.length} 笔，余下 ${card.count - rows.length} 笔请到网页端查看*`,
    });
  }

  return cardBodyV2({
    title: `${card.title} · ${card.count} 笔`,
    template: "wathet",
    elements,
  });
}

// ------------------------------------------------------------------ 统计

type StatsLike = Extract<AiCard, { kind: "stats_period" | "stats_month" }>;

function renderStatsCard(card: StatsLike, ctx: CardRenderContext): FeishuCardBody {
  const currency = card.currency ?? ctx.currency;
  // 只问一边的统计卡不展示另一边（旧卡片无 direction，按 both 渲染）。
  const direction = card.kind === "stats_period" ? (card.direction ?? "both") : "both";
  const showExpense = direction !== "income";
  const showIncome = direction !== "expense";
  // 双边都展示时补上差额（收入 − 支出），与 Web 统计卡的三列摘要一致。
  const balanceMicros = BigInt(card.incomeMicros) - BigInt(card.expenseMicros);
  const elements: FeishuCardBody[] = [
    {
      tag: "markdown",
      content: [
        ...(showExpense
          ? [`**支出** ${formatMicros(card.expenseMicros, ctx.decimalPlaces, currency)}`]
          : []),
        ...(showIncome
          ? [`**收入** ${formatMicros(card.incomeMicros, ctx.decimalPlaces, currency)}`]
          : []),
        ...(showExpense && showIncome
          ? [`**差额** ${formatMicros(balanceMicros, ctx.decimalPlaces, currency)}`]
          : []),
      ].join(`${COLUMN_GAP}${COLUMN_GAP}`),
    },
  ];

  // 旧月度卡只有支出分类；新卡按方向取对应一侧（direction=income 时只可能是 stats_period）。
  const categories =
    card.kind === "stats_period"
      ? showExpense
        ? card.expenseCategories
        : card.incomeCategories
      : card.topExpenseCategories;
  const hasCategoryChart = categories.length > 0;
  if (hasCategoryChart) {
    elements.push(categoryChart(showExpense ? "支出分类" : "收入分类", categories));
  }

  const trend = card.kind === "stats_period" ? card.trend : null;
  const hasTrendChart = Boolean(trend && trend.points.length > 0);
  if (trend && hasTrendChart) {
    const granularity = { day: "日", week: "周", month: "月" }[trend.granularity];
    const trendLabel = !showIncome ? "支出趋势" : !showExpense ? "收入趋势" : "收支趋势";
    elements.push(
      trendChart(`${trendLabel}（按${granularity}）`, trend.points, {
        showExpense,
        showIncome,
      }),
    );
  }

  // 显式判断「两张图都没有」，而不是数 elements 长度——后者依赖「摘要恰好占 1 个元素」，
  // 以后在摘要后面插任何元素，这个空数据提示就会静默失效。
  if (!hasCategoryChart && !hasTrendChart) {
    elements.push({ tag: "markdown", content: "暂无可绘制的分类或趋势数据。" });
  }

  const title =
    card.kind === "stats_period"
      ? `${card.title}（${card.dateFrom} ~ ${card.dateTo}）`
      : `${card.month} 收支`;
  return cardBodyV2({ title, template: "indigo", elements });
}

function categoryChart(
  title: string,
  categories: Array<{ name: string; amountMicros: string }>,
): FeishuCardBody {
  return {
    tag: "chart",
    element_id: "expense_chart",
    aspect_ratio: "16:9",
    color_theme: "rainbow",
    preview: true,
    chart_spec: {
      type: "bar",
      title: { text: title },
      data: {
        values: categories.slice(0, MAX_ROWS).map((category) => ({
          type: truncateTableText(category.name, 20),
          value: chartValue(category.amountMicros),
        })),
      },
      xField: "type",
      yField: "value",
      label: { visible: true },
    },
  };
}

function trendChart(
  title: string,
  points: Array<{ label: string; expenseMicros: string; incomeMicros: string }>,
  sides: { showExpense: boolean; showIncome: boolean },
): FeishuCardBody {
  return {
    tag: "chart",
    element_id: "trend_chart",
    aspect_ratio: "16:9",
    color_theme: "complementary",
    preview: true,
    chart_spec: {
      type: "line",
      title: { text: title },
      data: {
        values: points.flatMap((point) => [
          ...(sides.showExpense
            ? [
                {
                  date: truncateTableText(point.label, 24),
                  type: "支出",
                  value: chartValue(point.expenseMicros),
                },
              ]
            : []),
          ...(sides.showIncome
            ? [
                {
                  date: truncateTableText(point.label, 24),
                  type: "收入",
                  value: chartValue(point.incomeMicros),
                },
              ]
            : []),
        ]),
      },
      xField: "date",
      yField: "value",
      seriesField: "type",
      legends: { visible: true, orient: "bottom" },
    },
  };
}

// ------------------------------------------------------------------ 账户余额

function renderAccountBalancesCard(
  card: Extract<AiCard, { kind: "account_balances" }>,
  ctx: CardRenderContext,
): FeishuCardBody {
  const currency = card.currency ?? ctx.currency;
  const elements: FeishuCardBody[] = [
    fieldGrid([
      `**总资产**\n${formatMicros(card.totalAssetsMicros, ctx.decimalPlaces, currency)}`,
      `**总负债**\n${formatMicros(card.totalLiabilitiesMicros, ctx.decimalPlaces, currency)}`,
      `**净资产**\n${formatMicros(card.netWorthMicros, ctx.decimalPlaces, currency)}`,
    ]),
  ];

  if (card.accounts.length > 0) {
    elements.push({ tag: "hr" });
    elements.push(
      divText(
        card.accounts
          .map((account) => {
            // 负债账户的 balanceMicros 是记为正数的欠款，展示成负向更符合直觉。
            const amount = account.isLiability
              ? `-${formatMicros(account.balanceMicros, ctx.decimalPlaces, currency)}`
              : formatMicros(account.balanceMicros, ctx.decimalPlaces, currency);
            return `${escapeMd(account.name)}${COLUMN_GAP}${amount}`;
          })
          .join("\n"),
      ),
    );
  }

  return cardBody({ title: card.title, template: "turquoise", elements });
}

// ------------------------------------------------------------------ 预算进度

function renderBudgetCard(
  card: Extract<AiCard, { kind: "budget_progress" }>,
  ctx: CardRenderContext,
): FeishuCardBody {
  const currency = card.currency ?? ctx.currency;

  if (!card.enabled || card.totalBudgetMicros === null) {
    return cardBody({
      title: `${card.month} 预算`,
      template: "grey",
      elements: [divText("尚未设置预算。可在网页端「预算」页配置月度总预算与分类预算。")],
    });
  }

  const elements: FeishuCardBody[] = [
    divText(
      `**总预算**${COLUMN_GAP}${formatMicros(card.totalBudgetMicros, ctx.decimalPlaces, currency)}\n` +
        `**已用**${COLUMN_GAP}${formatMicros(card.usedMicros, ctx.decimalPlaces, currency)}${COLUMN_GAP}${progressBar(card.percent)} ${card.percent.toFixed(1)}%\n` +
        `**剩余**${COLUMN_GAP}${formatMicros(card.remainingMicros ?? "0", ctx.decimalPlaces, currency)}`,
    ),
  ];

  if (card.categories.length > 0) {
    elements.push({ tag: "hr" });
    elements.push(
      divText(
        `**分类预算**\n${card.categories
          .slice(0, MAX_ROWS)
          .map((category) => {
            const used = formatMicros(category.usedMicros, ctx.decimalPlaces, currency);
            if (category.budgetMicros === null)
              return `${escapeMd(category.name)}${COLUMN_GAP}已用 ${used}（未设预算）`;
            const budget = formatMicros(category.budgetMicros, ctx.decimalPlaces, currency);
            return `${escapeMd(category.name)}${COLUMN_GAP}${used} / ${budget}${COLUMN_GAP}${category.percent.toFixed(0)}%`;
          })
          .join("\n")}`,
      ),
    );
  }

  return cardBody({
    title: `${card.month} 预算`,
    template: card.percent >= 100 ? "red" : card.percent >= 80 ? "orange" : "green",
    elements,
  });
}

// ------------------------------------------------------------------ 构件

function cardBody(input: {
  title: string;
  template: string;
  elements: FeishuCardBody[];
}): FeishuCardBody {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.template,
      title: { tag: "plain_text", content: input.title },
    },
    elements: input.elements,
  };
}

/** 原生表格等新版组件使用的 JSON 2.0 卡片结构。 */
function cardBodyV2(input: {
  title: string;
  template: string;
  elements: FeishuCardBody[];
}): FeishuCardBody {
  return {
    schema: "2.0",
    config: {
      width_mode: "fill",
      summary: { content: input.title },
    },
    header: {
      template: input.template,
      title: { tag: "plain_text", content: input.title },
    },
    body: { elements: input.elements },
  };
}

function divText(content: string): FeishuCardBody {
  return { tag: "div", text: { tag: "lark_md", content } };
}

/** 双列字段网格；奇数个字段时最后一个独占一行。 */
function fieldGrid(contents: string[]): FeishuCardBody {
  return {
    tag: "div",
    fields: contents.map((content, index) => ({
      is_short: !(index === contents.length - 1 && contents.length % 2 === 1),
      text: { tag: "lark_md", content },
    })),
  };
}

function note(content: string): FeishuCardBody {
  return { tag: "note", elements: [{ tag: "plain_text", content }] };
}

function button(text: string, type: string, value: DraftActionValue): FeishuCardBody {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value,
  };
}

/**
 * micros → 图表数值（账本主单位）。
 *
 * 换算本身在 `microsToYuan` 里全程 bigint 完成，这里只把最终结果转成 number 交给 VChart：
 * 飞书图表的数值轴是线性轴，字符串画不出正确的柱高与折线。转换只发生在渲染边界，
 * 不参与任何金额计算，因此不触碰硬规则 1（前端 AiCards 也是同样的处理方式）。
 */
function chartValue(micros: string): number {
  return Number(microsToYuan(BigInt(micros)));
}

/** 表格单元格保持单行并限制长度，避免 50 行明细突破飞书单卡体积限制。 */
function truncateTableText(text: string, maxLength = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  return chars.length <= maxLength ? normalized : `${chars.slice(0, maxLength - 1).join("")}…`;
}

/** lark_md 里 `*` `_` 等有语义，用户备注/分类名可能含这些字符，转义掉避免串版。 */
export function escapeMd(text: string): string {
  return text.replace(/([*_~`[\]])/g, "\\$1");
}
