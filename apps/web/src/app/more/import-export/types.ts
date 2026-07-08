export type ImportRowIssue = { sheet: string; row: number; message: string };

export type ImportCounts = Record<string, { new: number; matched: number; skipped: number }>;

export type ImportResult = {
  dryRun: boolean;
  committed: boolean;
  counts: ImportCounts;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

/** dryRun=false 提交后返回的后台任务标识。 */
export type ImportJobEnqueued = { jobId: string };

/** 后台导入任务状态；succeeded 时 result 为最终 ImportResult。 */
export type ImportJobStatusResult = {
  status: "running" | "succeeded" | "failed";
  result: ImportResult | null;
  error: string | null;
};

export type RestoreResult = { counts: Record<string, number> };

/** counts key → 界面展示名，顺序即展示顺序。 */
export const IMPORT_COUNT_LABELS: [string, string][] = [
  ["transactions", "流水"],
  ["categories", "分类"],
  ["subcategories", "子分类"],
  ["people", "成员"],
  ["accounts", "账户"],
  ["subAccounts", "子账户"],
  ["insurances", "保险"],
  ["items", "物品"],
  ["itemTypes", "物品类型"],
];
