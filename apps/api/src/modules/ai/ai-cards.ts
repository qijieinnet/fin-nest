// AI 聊天消息携带的结构化卡片。存入 ai_messages.cards（JSONB），前端按 kind 渲染。
// 金额一律 micros 字符串（JSON 无 bigint）；确认草稿后由前端回写 status/transactionId。

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
