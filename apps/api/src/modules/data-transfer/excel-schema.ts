import { AppError } from "@fin-nest/backend";

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
  plans: "计划",
  budgets: "预算",
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
  { key: "relations", header: "往来关联", width: 24 },
  { key: "note", header: "备注", width: 24 },
];

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
  { key: "balance", header: "余额(元)", width: 12 },
];

export const INSURANCE_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 38 },
  { key: "name", header: "名称", width: 16 },
  { key: "type", header: "险种", width: 10 },
  { key: "insurer", header: "保险公司", width: 14 },
  { key: "method", header: "投保方式", width: 10 },
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

/** 往来关联里 可收回/需归还 的标记，编码格式：账户名/可收回/金额元，多条用；分隔。 */
export const RELATION_KIND_LABELS: Record<string, string> = {
  receivable: "可收回",
  payable: "需归还",
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
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) {
      return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    }
  }
  throw new Error("日期格式无效（应为 YYYY-MM-DD）");
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
    if (Array.isArray(candidate.richText)) return candidate.richText.map((part) => part.text).join("").trim();
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

export function importRowError(sheet: string, row: number, message: string): { sheet: string; row: number; message: string } {
  return { sheet, row, message };
}

export function assertBackupEnvelope(parsed: unknown): asserts parsed is { formatVersion: number; data: Record<string, unknown> } {
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
