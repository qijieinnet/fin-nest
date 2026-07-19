import type { AiCard, AiDraftFields } from "../ai/ai-cards";
import { formatMicros, percentOf, progressBar } from "./feishu-money";

/**
 * AiCard → 飞书交互卡片 JSON。纯函数，可离线单测。
 *
 * 约束：
 * - 金额一律走 `formatMicros`（bigint），**禁止 number 参与换算**（硬规则 1）；
 * - 按钮 value **只放 messageId + cardIndex**。userId / ledgerId 是客户端可篡改的输入，
 *   服务端一律从库里反查（见 docs/FEISHU_BOT_PLAN.md §8）；
 * - 飞书卡片渲染不了图表，趋势/占比一律降级为文本。
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

/** 列表类卡片最多展示的行数，超出提示去 Web 查看。 */
const MAX_ROWS = 10;

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
        button("确认入账", "primary", {
          action: "confirm_draft",
          messageId: ctx.messageId,
          cardIndex: ctx.cardIndex,
        }),
        button("作废", "default", {
          action: "discard_draft",
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
    fieldGrid([
      `**支出**\n${formatMicros(card.expenseMicros, ctx.decimalPlaces, currency)}`,
      `**收入**\n${formatMicros(card.incomeMicros, ctx.decimalPlaces, currency)}`,
    ]),
    { tag: "hr" },
  ];

  const rows = card.rows.slice(0, MAX_ROWS);
  if (rows.length === 0) {
    elements.push(divText("没有符合条件的记录。"));
  } else {
    elements.push(
      divText(
        rows
          .map((row) => {
            const label = row.categoryName ? escapeMd(row.categoryName) : "未分类";
            const amount = formatMicros(row.effectiveAmountMicros, ctx.decimalPlaces, currency);
            const suffix = row.note ? ` · ${escapeMd(row.note)}` : "";
            return `${row.occurredOn}${COLUMN_GAP}${label}${COLUMN_GAP}${amount}${suffix}`;
          })
          .join("\n"),
      ),
    );
  }

  if (card.rows.length > MAX_ROWS) {
    elements.push(
      note(`仅显示前 ${MAX_ROWS} 笔，余下 ${card.rows.length - MAX_ROWS} 笔请到网页端查看`),
    );
  }

  return cardBody({
    title: `${card.title} · ${card.count} 笔`,
    template: "wathet",
    elements,
  });
}

// ------------------------------------------------------------------ 统计

type StatsLike = Extract<AiCard, { kind: "stats_period" | "stats_month" }>;

function renderStatsCard(card: StatsLike, ctx: CardRenderContext): FeishuCardBody {
  const currency = card.currency ?? ctx.currency;
  const elements: FeishuCardBody[] = [
    fieldGrid([
      `**支出**\n${formatMicros(card.expenseMicros, ctx.decimalPlaces, currency)}`,
      `**收入**\n${formatMicros(card.incomeMicros, ctx.decimalPlaces, currency)}`,
    ]),
  ];

  const expenseCategories =
    card.kind === "stats_period" ? card.expenseCategories : card.topExpenseCategories;
  if (expenseCategories.length > 0) {
    elements.push({ tag: "hr" });
    elements.push(
      divText(
        `**支出分类**\n${expenseCategories
          .slice(0, MAX_ROWS)
          .map((category) => {
            const amount = "amountMicros" in category ? category.amountMicros : "0";
            const share = percentOf(amount, card.expenseMicros);
            return `${escapeMd(category.name)}${COLUMN_GAP}${formatMicros(amount, ctx.decimalPlaces, currency)}${COLUMN_GAP}${share.toFixed(1)}%`;
          })
          .join("\n")}`,
      ),
    );
  }

  // 飞书卡片渲染不了折线，趋势降级为逐点文本。
  if (card.kind === "stats_period" && card.trend) {
    const granularity = { day: "日", week: "周", month: "月" }[card.trend.granularity];
    elements.push({ tag: "hr" });
    elements.push(
      divText(
        `**趋势（按${granularity}）**\n${card.trend.points
          .map(
            (point) =>
              `${point.label}${COLUMN_GAP}支出 ${formatMicros(point.expenseMicros, ctx.decimalPlaces, currency)}${COLUMN_GAP}收入 ${formatMicros(point.incomeMicros, ctx.decimalPlaces, currency)}`,
          )
          .join("\n")}`,
      ),
    );
  }

  const title =
    card.kind === "stats_period"
      ? `${card.title}（${card.dateFrom} ~ ${card.dateTo}）`
      : `${card.month} 收支`;
  return cardBody({ title, template: "indigo", elements });
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

/** lark_md 里 `*` `_` 等有语义，用户备注/分类名可能含这些字符，转义掉避免串版。 */
export function escapeMd(text: string): string {
  return text.replace(/([*_~`[\]])/g, "\\$1");
}
