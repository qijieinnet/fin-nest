import { AppError } from "../errors/app-error";

/**
 * Excel 导入导出的唯一事实来源：sheet 名、列定义、枚举中英映射、金额/日期转换。
 * 导出与导入必须共用这里的定义，避免两侧漂移。
 */

export const SHEET_NAMES = {
  readme: "说明",
  transactions: "流水",
  categories: "分类",
  subcategories: "子分类",
  people: "成员",
  accounts: "账户",
  subAccounts: "子账户",
  insurances: "保险",
  items: "物品",
  itemTypes: "物品类型",
  subscriptions: "订阅",
  subscriptionCategories: "订阅分类",
  plans: "计划",
  budgets: "预算",
  accountEntries: "账户流水",
  lookup: "基础数据",
} as const;

export type ColumnDef = { key: string; header: string; width?: number };

export const TRANSACTION_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "occurredOn", header: "日期", width: 12 },
  { key: "type", header: "类型", width: 8 },
  { key: "amount", header: "金额(元)", width: 12 },
  { key: "category", header: "分类", width: 12 },
  { key: "subcategory", header: "子分类", width: 12 },
  { key: "account", header: "账户", width: 14 },
  { key: "subAccount", header: "子账户", width: 12 },
  { key: "fromAccount", header: "转出账户", width: 14 },
  { key: "fromSubAccount", header: "转出子账户", width: 12 },
  { key: "toAccount", header: "转入账户", width: 14 },
  { key: "toSubAccount", header: "转入子账户", width: 12 },
  { key: "person", header: "成员", width: 10 },
  { key: "insurance", header: "关联保险", width: 16 },
  { key: "item", header: "关联物品", width: 16 },
  { key: "subscription", header: "关联订阅", width: 16 },
  { key: "relations", header: "往来关联", width: 24 },
  { key: "note", header: "备注", width: 24 },
];

/**
 * 流水表的「只导出、不导入」补充列。
 *
 * 导入按表头名匹配 `TRANSACTION_COLUMNS`、忽略认不出的列，所以这些列只出现在全量导出里，
 * 不进模板、也不参与导入契约。存在的意义是：系统备份里的 Excel 要能独立还原「谁在什么时候记的账」。
 */
export const TRANSACTION_EXPORT_COLUMNS: ColumnDef[] = [
  { key: "createdByName", header: "记账人", width: 12 },
  { key: "createdAt", header: "记账时间", width: 18 },
];

/**
 * 账户流水（`account_entries`）。只导出：它由记账与余额调整派生，导入侧不接受手工流水，
 * 但脱离系统后要靠它对上每个账户的余额变化，因此必须进备份里的 Excel。
 */
export const ACCOUNT_ENTRY_COLUMNS: ColumnDef[] = [
  { key: "occurredAt", header: "时间", width: 18 },
  { key: "account", header: "账户", width: 14 },
  { key: "subAccount", header: "子账户", width: 12 },
  { key: "entryType", header: "类型", width: 10 },
  { key: "amountDelta", header: "变动(元)", width: 12 },
  { key: "balanceBefore", header: "变动前余额(元)", width: 14 },
  { key: "balanceAfter", header: "变动后余额(元)", width: 14 },
  { key: "transactionId", header: "关联流水ID", width: 38 },
  { key: "note", header: "备注", width: 20 },
];

export const ACCOUNT_ENTRY_TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer_in: "转入",
  transfer_out: "转出",
  receivable_increase: "可收回增加",
  receivable_decrease: "可收回减少",
  payable_increase: "需归还增加",
  payable_decrease: "需归还减少",
  adjustment: "余额调整",
  opening: "初始余额",
  reversal: "冲正",
};

export const CATEGORY_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "type", header: "类型", width: 8 },
  { key: "name", header: "名称", width: 14 },
  { key: "icon", header: "图标", width: 12 },
  { key: "sortOrder", header: "排序", width: 8 },
];

export const SUBCATEGORY_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "categoryType", header: "所属分类类型", width: 12 },
  { key: "category", header: "所属分类", width: 14 },
  { key: "name", header: "名称", width: 14 },
  { key: "icon", header: "图标", width: 12 },
  { key: "sortOrder", header: "排序", width: 8 },
];

export const PERSON_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "姓名", width: 12 },
  { key: "icon", header: "图标", width: 12 },
];

export const ACCOUNT_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "type", header: "账户类型", width: 10 },
  { key: "name", header: "名称", width: 14 },
  { key: "icon", header: "图标", width: 12 },
  { key: "person", header: "归属人员", width: 12 },
  { key: "balance", header: "余额(元)", width: 12 },
  { key: "includeInNetWorth", header: "计入净资产", width: 10 },
  { key: "creditLimit", header: "信用额度(元)", width: 12 },
  { key: "counterparty", header: "对方", width: 12 },
  { key: "billDay", header: "账单日", width: 8 },
  { key: "repayDay", header: "还款日", width: 8 },
];

export const SUB_ACCOUNT_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "account", header: "所属账户", width: 14 },
  { key: "name", header: "名称", width: 14 },
  { key: "icon", header: "图标", width: 12 },
  { key: "balance", header: "余额(元)", width: 12 },
  { key: "includeInNetWorth", header: "计入净资产", width: 10 },
];

export const INSURANCE_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 16 },
  { key: "type", header: "险种", width: 10 },
  { key: "insurer", header: "保险公司", width: 14 },
  { key: "method", header: "投保方式", width: 10 },
  { key: "paymentMethod", header: "缴费方式", width: 12 },
  { key: "policyNo", header: "保单号", width: 16 },
  { key: "coverage", header: "保额(元)", width: 12 },
  { key: "premium", header: "保费(元)", width: 12 },
  { key: "premiumFreq", header: "缴费频率", width: 10 },
  { key: "periods", header: "期数", width: 8 },
  { key: "renewal", header: "续保", width: 10 },
  { key: "coverageDesc", header: "保障内容", width: 24 },
  { key: "startDate", header: "生效日", width: 12 },
  { key: "endDate", header: "到期日", width: 12 },
  { key: "insuredPeople", header: "被保人", width: 14 },
  { key: "note", header: "备注", width: 20 },
];

export const ITEM_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 16 },
  { key: "itemType", header: "物品类型", width: 12 },
  { key: "purchasePrice", header: "购入价格(元)", width: 12 },
  { key: "purchaseDate", header: "购入日期", width: 12 },
  { key: "expectedYears", header: "预计年限", width: 10 },
  { key: "note", header: "备注", width: 20 },
];

export const ITEM_TYPE_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 14 },
  { key: "sortOrder", header: "排序", width: 8 },
];

export const SUBSCRIPTION_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 16 },
  { key: "category", header: "订阅分类", width: 12 },
  { key: "provider", header: "服务商", width: 14 },
  { key: "planName", header: "套餐", width: 12 },
  { key: "price", header: "费用(元)", width: 12 },
  { key: "billingCycle", header: "计费周期", width: 10 },
  { key: "paymentMethod", header: "支付方式", width: 12 },
  { key: "autoRenew", header: "自动续费", width: 10 },
  { key: "startDate", header: "开通日", width: 12 },
  { key: "nextRenewalDate", header: "下次续费日", width: 12 },
  { key: "note", header: "备注", width: 20 },
];

export const SUBSCRIPTION_CATEGORY_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 14 },
  { key: "icon", header: "图标", width: 12 },
  { key: "sortOrder", header: "排序", width: 8 },
];

/** 计费周期中英映射，与前端选项保持一致。 */
export const BILLING_CYCLE_LABELS: Record<string, string> = {
  weekly: "每周",
  monthly: "每月",
  quarterly: "每季",
  yearly: "每年",
  custom: "自定义",
};

export const PLAN_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "kind", header: "类型", width: 10 },
  { key: "metric", header: "指标", width: 10 },
  { key: "name", header: "名称", width: 16 },
  { key: "limitAmount", header: "限额(元)", width: 12 },
  { key: "limitCount", header: "限次", width: 8 },
  { key: "startDate", header: "开始日期", width: 12 },
  { key: "repeatRule", header: "重复规则", width: 12 },
];

export const BUDGET_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "category", header: "分类", width: 14 },
  { key: "amount", header: "金额(元)", width: 12 },
];

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "储蓄",
  credit: "信用",
  invest: "投资",
  receivable: "可收回",
  payable: "需归还",
};

export const CATEGORY_TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
};

export const BOOLEAN_LABELS: Record<string, string> = { true: "是", false: "否" };

/** 往来关联标记，编码格式：账户名/计入可收回/金额元，多条用；分隔。 */
export const RELATION_KIND_LABELS: Record<string, string> = {
  receivable_from_expense: "计入可收回",
  payable_from_income: "产生需归还",
  receivable_from_income: "冲减可收回",
  payable_from_expense: "冲减需归还",
};

export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (value == null) return "";
  return map[value] ?? value;
}

export function valueOfLabel(map: Record<string, string>, label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  for (const [value, text] of Object.entries(map)) {
    if (text === trimmed || value === trimmed) return value;
  }
  return null;
}

const MICROS_PER_YUAN = 1_000_000n;

/** micros → 元（number，用于写入 Excel 数字单元格；账本金额量级下精度足够）。 */
export function microsToYuanNumber(micros: bigint | null | undefined): number | null {
  if (micros == null) return null;
  return Number(micros) / 1_000_000;
}

/**
 * Excel 单元格 → micros 字符串。接受数字单元格或字符串，最多 2 位小数。
 * 全程字符串/BigInt 运算，数字单元格先四舍五入到分再换算，避免浮点残差。
 */
export function cellToMicrosString(value: unknown, opts: { allowNegative?: boolean } = {}): string {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("金额不是有效数字");
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6) throw new Error("金额最多 2 位小数");
    text = (cents / 100).toFixed(2);
  } else if (typeof value === "string") {
    text = value.trim();
  } else if (value != null && typeof value === "object" && "result" in value) {
    // 公式单元格取计算结果。
    return cellToMicrosString((value as { result: unknown }).result, opts);
  } else {
    throw new Error("金额格式无效");
  }
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("金额格式无效（最多 2 位小数）");
  const [, sign, whole, fraction = ""] = match;
  if (sign === "-" && !opts.allowNegative) throw new Error("金额不能为负数");
  const micros = BigInt(whole!) * MICROS_PER_YUAN + BigInt(fraction.padEnd(6, "0"));
  return `${sign}${micros}`;
}

/** Prisma @db.Date（UTC）→ YYYY-MM-DD。 */
export function dateToText(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * 时间戳 → 应用时区的 `YYYY-MM-DD HH:mm`（只导出，不参与导入）。
 * 直接取 UTC 分量会让东八区的凌晨记账显示成前一天，脱离系统看 Excel 时无从纠正。
 */
export function dateTimeToText(value: Date | null | undefined): string {
  if (!value) return "";
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat("sv-SE", { ...options, timeZone }).format(value);
  } catch {
    return new Intl.DateTimeFormat("sv-SE", { ...options, timeZone: "UTC" }).format(value);
  }
}

/**
 * Excel 单元格 → YYYY-MM-DD。exceljs 对日期格式单元格返回 JS Date（UTC 语义），
 * 必须按 UTC 分量取值，本地时区取值会差一天。
 */
export function cellToDateText(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "string") {
    const text = value.trim().replaceAll("/", "-");
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(text);
    if (match) {
      return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    }
  }
  throw new Error("日期格式无效（应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）");
}

/** 读取单元格为去空格文本；空/undefined 返回空串。 */
export function cellToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return cellToDateText(value);
  if (typeof value === "object") {
    // exceljs 富文本 / 超链接 / 公式单元格。
    const candidate = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (Array.isArray(candidate.richText))
      return candidate.richText
        .map((part) => part.text)
        .join("")
        .trim();
    if (candidate.text != null) return cellToText(candidate.text);
    if (candidate.result != null) return cellToText(candidate.result);
  }
  return String(value).trim();
}

/** 读取整数单元格（排序、期数等）。 */
export function cellToInt(value: unknown): number | null {
  const text = cellToText(value);
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) throw new Error("必须是整数");
  return parsed;
}

export const IMPORT_MAX_TRANSACTION_ROWS = 5000;

export function importRowError(
  sheet: string,
  row: number,
  message: string,
): { sheet: string; row: number; message: string } {
  return { sheet, row, message };
}

export function assertBackupEnvelope(
  parsed: unknown,
): asserts parsed is { formatVersion: number; data: Record<string, unknown> } {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { app?: unknown }).app !== "fin-nest" ||
    (parsed as { kind?: unknown }).kind !== "ledger-backup" ||
    typeof (parsed as { data?: unknown }).data !== "object"
  ) {
    throw new AppError("BACKUP_INVALID_FORMAT", "备份文件格式无效", 400);
  }
  if ((parsed as { formatVersion?: unknown }).formatVersion !== 1) {
    throw new AppError("BACKUP_VERSION_UNSUPPORTED", "备份文件版本不受支持", 400);
  }
}
