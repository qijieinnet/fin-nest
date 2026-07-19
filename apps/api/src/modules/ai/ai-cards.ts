// AI 聊天消息携带的结构化卡片。存入 ai_messages.cards（JSONB），前端按 kind 渲染。
// 金额一律 micros 字符串（JSON 无 bigint）；确认草稿后由前端回写 status/transactionId。

/**
 * 模型只产出卡片、没产出文字时的占位正文。
 *
 * Web 端卡片渲染在正文上方，所以「上面的卡片」措辞成立。其它渲染端（如飞书，卡片是
 * 紧随其后的独立消息）应当识别出这是占位而非模型的真实输出，跳过不显示——
 * 因此抽成常量而不是散落的字符串字面量。
 */
export const AI_CARDS_ONLY_PLACEHOLDER = "已生成上面的卡片，请查看。";

export type AiDraftFields = {
  type: "expense" | "income" | "transfer";
  grossAmountMicros: string;
  occurredOn: string;
  currency?: string;
  categoryId?: string;
  categoryName?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  personId?: string;
  personName?: string;
  accountId?: string;
  accountName?: string;
  subAccountId?: string;
  subAccountName?: string;
  fromAccountId?: string;
  fromAccountName?: string;
  fromSubAccountId?: string;
  fromSubAccountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  toSubAccountId?: string;
  toSubAccountName?: string;
  note?: string;
};

export type AiTransactionRow = {
  occurredOn: string;
  type: string;
  effectiveAmountMicros: string;
  categoryName?: string;
  note?: string;
};

export type AiStatsCategory = {
  name: string;
  icon?: string | null;
  amountMicros: string;
};

export type AiStatsTrend = {
  granularity: "day" | "week" | "month";
  points: Array<{
    label: string;
    expenseMicros: string;
    incomeMicros: string;
  }>;
};

export type AiAccountBalance = {
  name: string;
  type: string;
  balanceMicros: string;
  /** 负债类账户（信用/需归还）：balanceMicros 记为正数的欠款，前端展示为负向。 */
  isLiability: boolean;
};

export type AiBudgetCategory = {
  name: string;
  budgetMicros: string | null;
  usedMicros: string;
  remainingMicros: string | null;
  percent: number;
};

export type AiCard =
  | {
      kind: "transaction_draft";
      // proposed：待确认；confirmed：已入账；superseded：被后续修正草稿作废，不可再确认。
      status: "proposed" | "confirmed" | "superseded";
      transactionId?: string;
      confirmationBlockedReason?: string;
      draft: AiDraftFields;
    }
  | {
      kind: "transactions";
      title: string;
      currency?: string;
      count: number;
      expenseMicros: string;
      incomeMicros: string;
      rows: AiTransactionRow[];
    }
  | {
      // 已无工具生成此卡；仅为渲染历史消息中的旧月度统计卡保留，勿用于新功能。
      kind: "stats_month";
      month: string;
      currency?: string;
      expenseMicros: string;
      incomeMicros: string;
      topExpenseCategories: Array<{ name: string; amountMicros: string }>;
    }
  | {
      kind: "stats_period";
      title: string;
      dateFrom: string;
      dateTo: string;
      currency?: string;
      expenseMicros: string;
      incomeMicros: string;
      expenseCategories: AiStatsCategory[];
      incomeCategories: AiStatsCategory[];
      trend?: AiStatsTrend;
    }
  | {
      kind: "account_balances";
      title: string;
      currency?: string;
      totalAssetsMicros: string;
      totalLiabilitiesMicros: string;
      netWorthMicros: string;
      accounts: AiAccountBalance[];
    }
  | {
      kind: "budget_progress";
      month: string;
      currency?: string;
      enabled: boolean;
      totalBudgetMicros: string | null;
      usedMicros: string;
      remainingMicros: string | null;
      percent: number;
      categories: AiBudgetCategory[];
    };
