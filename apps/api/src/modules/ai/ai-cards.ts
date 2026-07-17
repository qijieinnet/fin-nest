// AI 聊天消息携带的结构化卡片。存入 ai_messages.cards（JSONB），前端按 kind 渲染。
// 金额一律 micros 字符串（JSON 无 bigint）；确认草稿后由前端回写 status/transactionId。

export type AiDraftFields = {
  type: "expense" | "income" | "transfer";
  grossAmountMicros: string;
  occurredOn: string;
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
  grossAmountMicros: string;
  categoryName?: string;
  note?: string;
};

export type AiCard =
  | {
      kind: "transaction_draft";
      status: "proposed" | "confirmed";
      transactionId?: string;
      draft: AiDraftFields;
    }
  | {
      kind: "transactions";
      title: string;
      count: number;
      expenseMicros: string;
      incomeMicros: string;
      rows: AiTransactionRow[];
    }
  | {
      kind: "stats_month";
      month: string;
      expenseMicros: string;
      incomeMicros: string;
      topExpenseCategories: Array<{ name: string; amountMicros: string }>;
    };
