import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import ExcelJS from "exceljs";
import { LedgersService } from "../ledgers/ledgers.service";
import { TransactionsService } from "../transactions/transactions.service";
import { BULK_TX_OPTIONS } from "./backup.service";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_TYPE_LABELS,
  BILLING_CYCLE_LABELS,
  CATEGORY_COLUMNS,
  CATEGORY_TYPE_LABELS,
  cellToDateText,
  cellToInt,
  cellToMicrosString,
  cellToText,
  ColumnDef,
  IMPORT_MAX_TRANSACTION_ROWS,
  INSURANCE_COLUMNS,
  ITEM_COLUMNS,
  ITEM_TYPE_COLUMNS,
  PERSON_COLUMNS,
  RELATION_KIND_LABELS,
  SHEET_NAMES,
  SUB_ACCOUNT_COLUMNS,
  SUBCATEGORY_COLUMNS,
  SUBSCRIPTION_CATEGORY_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  TRANSACTION_COLUMNS,
  TRANSACTION_TYPE_LABELS,
  valueOfLabel,
} from "./excel-schema";

export type ImportRowIssue = { sheet: string; row: number; message: string };

export type ImportResult = {
  dryRun: boolean;
  committed: boolean;
  counts: Record<string, { new: number; matched: number; skipped: number }>;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

/** 注册表条目：已有实体带 id；本文件新增的实体 id 在提交阶段创建后回填。 */
type Ref = { id: string | null };

type PlannedCategory = {
  ref: Ref;
  type: string;
  name: string;
  icon: string | null;
  sortOrder: number;
};
type PlannedSubcategory = {
  ref: Ref;
  categoryRef: Ref;
  name: string;
  icon: string | null;
  sortOrder: number;
};
type PlannedPerson = { ref: Ref; name: string; icon: string | null };
type PlannedAccount = {
  ref: Ref;
  type: string;
  name: string;
  icon: string | null;
  balanceMicros: string;
  includeInNetWorth: boolean;
  creditLimitMicros: string | null;
  counterparty: string | null;
  billDay: number | null;
  repayDay: number | null;
};
type PlannedSubAccount = {
  ref: Ref;
  accountRef: Ref;
  name: string;
  icon: string | null;
  balanceMicros: string;
  includeInNetWorth: boolean;
};
type PlannedItemType = { ref: Ref; name: string; sortOrder: number };
type PlannedItem = {
  ref: Ref;
  name: string;
  itemTypeRef: Ref | null;
  purchasePriceMicros: string | null;
  purchaseDate: string | null;
  expectedYears: string | null;
  note: string | null;
};
type PlannedInsurance = {
  ref: Ref;
  name: string;
  type: string;
  insurer: string | null;
  method: string | null;
  paymentMethod: string | null;
  policyNo: string | null;
  coverageMicros: string | null;
  premiumMicros: string | null;
  premiumFreq: string | null;
  periods: number | null;
  renewal: string | null;
  coverageDesc: string | null;
  startDate: string | null;
  endDate: string | null;
  insuredPeopleRefs: Ref[];
  note: string | null;
};
type PlannedSubscriptionCategory = { ref: Ref; name: string; icon: string | null; sortOrder: number };
type PlannedSubscription = {
  ref: Ref;
  name: string;
  categoryRef: Ref | null;
  provider: string | null;
  planName: string | null;
  priceMicros: string | null;
  billingCycle: string | null;
  paymentMethod: string | null;
  autoRenew: boolean;
  startDate: string | null;
  nextRenewalDate: string | null;
  note: string | null;
};
type PlannedTransaction = {
  row: number;
  type: string;
  occurredOn: string;
  grossAmountMicros: string;
  categoryRef: Ref | null;
  subcategoryRef: Ref | null;
  accountRef: Ref | null;
  subAccountRef: Ref | null;
  fromAccountRef: Ref | null;
  fromSubAccountRef: Ref | null;
  toAccountRef: Ref | null;
  toSubAccountRef: Ref | null;
  personRef: Ref | null;
  insuranceRefs: Ref[];
  itemRefs: Ref[];
  subscriptionRefs: Ref[];
  relations: { accountRef: Ref; relationKind: string; amountMicros: string }[];
  note: string | null;
};

type AccountInfo = { ref: Ref; type: string };

/** 校验阶段构建的名称解析表：数据库活跃行 ∪ 本文件新增行。 */
type Registry = {
  categoryByKey: Map<string, Ref>; // `${type}:${name}`
  subcategoryByKey: Map<string, Ref>; // `${type}:${categoryName}:${name}`
  personByName: Map<string, Ref>;
  accountByName: Map<string, AccountInfo>;
  subAccountByKey: Map<string, Ref>; // `${accountName}:${name}`
  insuranceByName: Map<string, Ref>;
  itemByName: Map<string, Ref>;
  itemTypeByName: Map<string, Ref>;
  subscriptionByName: Map<string, Ref>;
  subscriptionCategoryByName: Map<string, Ref>;
  existingIds: Set<string>;
};

type Plan = {
  categories: PlannedCategory[];
  subcategories: PlannedSubcategory[];
  people: PlannedPerson[];
  accounts: PlannedAccount[];
  subAccounts: PlannedSubAccount[];
  itemTypes: PlannedItemType[];
  items: PlannedItem[];
  insurances: PlannedInsurance[];
  subscriptionCategories: PlannedSubscriptionCategory[];
  subscriptions: PlannedSubscription[];
  transactions: PlannedTransaction[];
};

@Injectable()
export class ExcelImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
    private readonly transactions: TransactionsService,
  ) {}

  /** 后台运行中的任务超过此时长视为超时失败，防止 API 重启后 running 行永久卡死。 */
  private static readonly JOB_STALE_MS = 10 * 60_000;

  /**
   * 提交导入（dryRun=false）改为后台执行：建任务行后立即返回 jobId，
   * 实际导入在 API 进程内异步跑完再写回结果，避免长事务占用 HTTP 连接被代理超时切断。
   */
  async startImportJob(
    ledgerId: string,
    userId: string,
    file: Buffer,
  ): Promise<{ jobId: string }> {
    await this.ledgers.assertMember(ledgerId, userId);
    const job = await this.prisma.client.importJob.create({
      data: { ledgerId, userId, status: "running" },
    });
    // fire-and-forget：脱离 HTTP 请求生命周期，结果写入 import_jobs。
    void this.runImportJob(job.id, ledgerId, userId, file);
    return { jobId: job.id };
  }

  private async runImportJob(
    jobId: string,
    ledgerId: string,
    userId: string,
    file: Buffer,
  ): Promise<void> {
    try {
      const result = await this.importExcel(ledgerId, userId, file, false);
      // 条件写回：仅在仍为 running 时更新，避免覆盖已被判超时（stale）的终态而造成状态翻转。
      await this.prisma.client.importJob.updateMany({
        where: { id: jobId, status: "running" },
        data: { status: "succeeded", result: result as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      await this.prisma.client.importJob
        .updateMany({
          where: { id: jobId, status: "running" },
          data: { status: "failed", error: messageOf(error).slice(0, 2000) },
        })
        .catch(() => undefined);
    }
  }

  async getImportJob(
    ledgerId: string,
    userId: string,
    jobId: string,
  ): Promise<{ status: string; result: ImportResult | null; error: string | null }> {
    await this.ledgers.assertMember(ledgerId, userId);
    const job = await this.prisma.client.importJob.findFirst({ where: { id: jobId, ledgerId } });
    if (!job) throw new AppError("IMPORT_JOB_NOT_FOUND", "导入任务不存在", 404);
    // running 超过阈值多为进程崩溃残留（后台导入受 300s 事务上限约束，健康任务不会到达此时长）。
    // 条件更新避免覆盖同期刚写入的终态；若未命中则说明任务已完成，读取最新状态返回。
    if (
      job.status === "running" &&
      Date.now() - job.updatedAt.getTime() > ExcelImportService.JOB_STALE_MS
    ) {
      const timedOut = await this.prisma.client.importJob.updateMany({
        where: { id: jobId, status: "running" },
        data: { status: "failed", error: "导入超时，请重试" },
      });
      if (timedOut.count > 0) return { status: "failed", result: null, error: "导入超时，请重试" };
      const fresh = await this.prisma.client.importJob.findFirstOrThrow({
        where: { id: jobId, ledgerId },
      });
      return this.mapImportJob(fresh);
    }
    return this.mapImportJob(job);
  }

  private mapImportJob(job: {
    status: string;
    result: Prisma.JsonValue | null;
    error: string | null;
  }): { status: string; result: ImportResult | null; error: string | null } {
    return {
      status: job.status,
      result: (job.result as ImportResult | null) ?? null,
      error: job.error,
    };
  }

  async importExcel(
    ledgerId: string,
    userId: string,
    file: Buffer,
    dryRun: boolean,
  ): Promise<ImportResult> {
    await this.ledgers.assertMember(ledgerId, userId);

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
    } catch {
      throw new AppError("IMPORT_INVALID_FILE", "无法解析 Excel 文件（需要 .xlsx 格式）", 400);
    }

    const errors: ImportRowIssue[] = [];
    const warnings: ImportRowIssue[] = [];
    const counts: ImportResult["counts"] = {};
    const registry = await this.buildRegistry(ledgerId);
    const plan: Plan = {
      categories: [],
      subcategories: [],
      people: [],
      accounts: [],
      subAccounts: [],
      itemTypes: [],
      items: [],
      insurances: [],
      subscriptionCategories: [],
      subscriptions: [],
      transactions: [],
    };

    // 基础数据先于流水解析，流水的名称引用可以指向本文件新增的行。
    this.parseItemTypes(workbook, registry, plan, counts, errors, warnings);
    this.parsePeople(workbook, registry, plan, counts, errors, warnings);
    this.parseCategories(workbook, registry, plan, counts, errors, warnings);
    this.parseSubcategories(workbook, registry, plan, counts, errors, warnings);
    this.parseAccounts(workbook, registry, plan, counts, errors, warnings);
    this.parseSubAccounts(workbook, registry, plan, counts, errors, warnings);
    this.parseInsurances(workbook, registry, plan, counts, errors, warnings);
    this.parseItems(workbook, registry, plan, counts, errors, warnings);
    this.parseSubscriptionCategories(workbook, registry, plan, counts, errors, warnings);
    this.parseSubscriptions(workbook, registry, plan, counts, errors, warnings);
    await this.parseTransactions(ledgerId, workbook, registry, plan, counts, errors, warnings);

    if (errors.length > 0 || dryRun) {
      return { dryRun, committed: false, counts, errors, warnings };
    }

    try {
      await this.commit(ledgerId, userId, plan, counts);
    } catch (error) {
      errors.push({
        sheet: SHEET_NAMES.transactions,
        row: 0,
        message: `导入提交失败：${messageOf(error)}`,
      });
      return { dryRun: false, committed: false, counts, errors, warnings };
    }
    return { dryRun: false, committed: true, counts, errors: [], warnings };
  }

  private async buildRegistry(ledgerId: string): Promise<Registry> {
    const client = this.prisma.client;
    const where = { ledgerId };
    const [
      categories,
      subcategories,
      people,
      accounts,
      subAccounts,
      insurances,
      items,
      itemTypes,
      subscriptions,
      subscriptionCategories,
      transactions,
    ] = await Promise.all([
      client.category.findMany({ where: { ...where, archivedAt: null } }),
      client.subcategory.findMany({ where: { ...where, archivedAt: null } }),
      client.person.findMany({ where: { ...where, archivedAt: null } }),
      client.account.findMany({ where: { ...where, archivedAt: null } }),
      client.subAccount.findMany({ where: { ...where, archivedAt: null } }),
      client.insurance.findMany({ where: { ...where, deletedAt: null } }),
      client.item.findMany({ where: { ...where, deletedAt: null } }),
      client.itemType.findMany({ where }),
      client.subscription.findMany({ where: { ...where, deletedAt: null } }),
      client.subscriptionCategory.findMany({ where }),
      client.transaction.findMany({ where, select: { id: true } }),
    ]);

    const categoryById = new Map(categories.map((row) => [row.id, row]));
    const accountById = new Map(accounts.map((row) => [row.id, row]));
    const registry: Registry = {
      categoryByKey: new Map(categories.map((row) => [`${row.type}:${row.name}`, { id: row.id }])),
      subcategoryByKey: new Map(
        subcategories
          .filter((row) => categoryById.has(row.categoryId))
          .map((row) => {
            const category = categoryById.get(row.categoryId)!;
            return [`${category.type}:${category.name}:${row.name}`, { id: row.id }] as const;
          }),
      ),
      personByName: new Map(people.map((row) => [row.name, { id: row.id }])),
      accountByName: new Map(
        accounts.map((row) => [row.name, { ref: { id: row.id }, type: row.type }]),
      ),
      subAccountByKey: new Map(
        subAccounts
          .filter((row) => accountById.has(row.accountId))
          .map(
            (row) =>
              [`${accountById.get(row.accountId)!.name}:${row.name}`, { id: row.id }] as const,
          ),
      ),
      insuranceByName: new Map(insurances.map((row) => [row.name, { id: row.id }])),
      itemByName: new Map(items.map((row) => [row.name, { id: row.id }])),
      itemTypeByName: new Map(itemTypes.map((row) => [row.name, { id: row.id }])),
      subscriptionByName: new Map(subscriptions.map((row) => [row.name, { id: row.id }])),
      subscriptionCategoryByName: new Map(
        subscriptionCategories.map((row) => [row.name, { id: row.id }]),
      ),
      existingIds: new Set([
        ...categories.map((row) => row.id),
        ...subcategories.map((row) => row.id),
        ...people.map((row) => row.id),
        ...accounts.map((row) => row.id),
        ...subAccounts.map((row) => row.id),
        ...insurances.map((row) => row.id),
        ...items.map((row) => row.id),
        ...itemTypes.map((row) => row.id),
        ...subscriptions.map((row) => row.id),
        ...subscriptionCategories.map((row) => row.id),
        ...transactions.map((row) => row.id),
      ]),
    };
    return registry;
  }

  /**
   * 逐行读取 sheet。按第一行表头（而非固定列号）定位列，用户调整列顺序也能导入。
   * 返回 null 表示 sheet 不存在。
   */
  private *sheetRows(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    columns: ColumnDef[],
  ): Generator<{ rowNumber: number; value: (key: string) => unknown }> {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return;
    const headerRow = sheet.getRow(1);
    const columnByKey = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const header = cellToText(cell.value);
      const column = columns.find((item) => item.header === header);
      if (column) columnByKey.set(column.key, colNumber);
    });
    if (!columnByKey.size) return;
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const value = (key: string): unknown => {
        const colNumber = columnByKey.get(key);
        return colNumber ? row.getCell(colNumber).value : null;
      };
      const hasContent = [...columnByKey.values()].some(
        (colNumber) => cellToText(row.getCell(colNumber).value) !== "",
      );
      if (!hasContent) continue;
      yield { rowNumber, value };
    }
  }

  /** 通用的 新行/已有行 分流：返回 null 表示该行不需要作为新增处理（已有/已匹配/出错）。 */
  private classifyRow(
    sheetName: string,
    rowNumber: number,
    idValue: unknown,
    registry: Registry,
    count: { new: number; matched: number; skipped: number },
    warnings: ImportRowIssue[],
  ): "new" | "skip" {
    const id = cellToText(idValue);
    if (id) {
      count.skipped += 1;
      if (!registry.existingIds.has(id)) {
        warnings.push({
          sheet: sheetName,
          row: rowNumber,
          message: "该行的 ID 在账本中不存在，已跳过",
        });
      }
      return "skip";
    }
    return "new";
  }

  private ensureCount(
    counts: ImportResult["counts"],
    key: string,
  ): { new: number; matched: number; skipped: number } {
    if (!counts[key]) counts[key] = { new: 0, matched: 0, skipped: 0 };
    return counts[key];
  }

  private parseItemTypes(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.itemTypes;
    const count = this.ensureCount(counts, "itemTypes");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, ITEM_TYPE_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.itemTypeByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`物品类型「${name}」在文件中重复`);
        seen.add(name);
        const ref: Ref = { id: null };
        registry.itemTypeByName.set(name, ref);
        plan.itemTypes.push({ ref, name, sortOrder: cellToInt(value("sortOrder")) ?? 0 });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parsePeople(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.people;
    const count = this.ensureCount(counts, "people");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, PERSON_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("姓名不能为空");
        if (registry.personByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`成员「${name}」在文件中重复`);
        seen.add(name);
        const ref: Ref = { id: null };
        registry.personByName.set(name, ref);
        plan.people.push({ ref, name, icon: cellToText(value("icon")) || null });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseCategories(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.categories;
    const count = this.ensureCount(counts, "categories");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, CATEGORY_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const type = valueOfLabel(CATEGORY_TYPE_LABELS, cellToText(value("type")));
        if (!type) throw new Error("类型必须是 支出 或 收入");
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        const key = `${type}:${name}`;
        if (registry.categoryByKey.has(key)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(key)) throw new Error(`分类「${name}」在文件中重复`);
        seen.add(key);
        const ref: Ref = { id: null };
        registry.categoryByKey.set(key, ref);
        plan.categories.push({
          ref,
          type,
          name,
          icon: cellToText(value("icon")) || null,
          sortOrder: cellToInt(value("sortOrder")) ?? 0,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseSubcategories(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.subcategories;
    const count = this.ensureCount(counts, "subcategories");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, SUBCATEGORY_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        const categoryName = cellToText(value("category"));
        if (!categoryName) throw new Error("所属分类不能为空");
        const typeText = cellToText(value("categoryType"));
        const categoryKey = this.resolveCategoryKey(registry, typeText, categoryName);
        const key = `${categoryKey}:${name}`;
        if (registry.subcategoryByKey.has(key)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(key)) throw new Error(`子分类「${name}」在文件中重复`);
        seen.add(key);
        const ref: Ref = { id: null };
        registry.subcategoryByKey.set(key, ref);
        plan.subcategories.push({
          ref,
          categoryRef: registry.categoryByKey.get(categoryKey)!,
          name,
          icon: cellToText(value("icon")) || null,
          sortOrder: cellToInt(value("sortOrder")) ?? 0,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  /** 按（可选的）类型 + 名称定位分类 key；名称在支出/收入里都存在且未指定类型时报歧义。 */
  private resolveCategoryKey(registry: Registry, typeText: string, categoryName: string): string {
    if (typeText) {
      const type = valueOfLabel(CATEGORY_TYPE_LABELS, typeText);
      if (!type) throw new Error("所属分类类型必须是 支出 或 收入");
      const key = `${type}:${categoryName}`;
      if (!registry.categoryByKey.has(key))
        throw new Error(`分类「${categoryName}」不存在（可先在分类表新增）`);
      return key;
    }
    const candidates = ["expense", "income"]
      .map((type) => `${type}:${categoryName}`)
      .filter((key) => registry.categoryByKey.has(key));
    if (candidates.length === 0)
      throw new Error(`分类「${categoryName}」不存在（可先在分类表新增）`);
    if (candidates.length > 1)
      throw new Error(`分类「${categoryName}」在支出和收入中都存在，请填写所属分类类型`);
    return candidates[0]!;
  }

  private parseAccounts(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.accounts;
    const count = this.ensureCount(counts, "accounts");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, ACCOUNT_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.accountByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`账户「${name}」在文件中重复`);
        const type = valueOfLabel(ACCOUNT_TYPE_LABELS, cellToText(value("type")));
        if (!type) throw new Error("账户类型必须是 储蓄/信用/投资/可收回/需归还 之一");
        seen.add(name);
        const includeText = cellToText(value("includeInNetWorth"));
        const ref: Ref = { id: null };
        registry.accountByName.set(name, { ref, type });
        plan.accounts.push({
          ref,
          type,
          name,
          icon: cellToText(value("icon")) || null,
          balanceMicros: hasCellValue(value("balance"))
            ? cellToMicrosString(value("balance"), { allowNegative: true })
            : "0",
          includeInNetWorth: includeText ? includeText !== "否" : true,
          creditLimitMicros: hasCellValue(value("creditLimit"))
            ? cellToMicrosString(value("creditLimit"))
            : null,
          counterparty: cellToText(value("counterparty")) || null,
          billDay: cellToInt(value("billDay")),
          repayDay: cellToInt(value("repayDay")),
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseSubAccounts(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.subAccounts;
    const count = this.ensureCount(counts, "subAccounts");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, SUB_ACCOUNT_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        const accountName = cellToText(value("account"));
        if (!accountName) throw new Error("所属账户不能为空");
        const account = registry.accountByName.get(accountName);
        if (!account) throw new Error(`账户「${accountName}」不存在（可先在账户表新增）`);
        const key = `${accountName}:${name}`;
        if (registry.subAccountByKey.has(key)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(key)) throw new Error(`子账户「${name}」在文件中重复`);
        seen.add(key);
        const ref: Ref = { id: null };
        registry.subAccountByKey.set(key, ref);
        plan.subAccounts.push({
          ref,
          accountRef: account.ref,
          name,
          icon: cellToText(value("icon")) || null,
          balanceMicros: hasCellValue(value("balance"))
            ? cellToMicrosString(value("balance"), { allowNegative: true })
            : "0",
          includeInNetWorth: cellToText(value("includeInNetWorth")) !== "否",
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseInsurances(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.insurances;
    const count = this.ensureCount(counts, "insurances");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, INSURANCE_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.insuranceByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`保险「${name}」在文件中重复`);
        const type = cellToText(value("type"));
        if (!type) throw new Error("险种不能为空");
        const insuredPeopleRefs = splitNames(cellToText(value("insuredPeople"))).map(
          (personName) => {
            const person = registry.personByName.get(personName);
            if (!person) throw new Error(`被保人「${personName}」不存在（可先在成员表新增）`);
            return person;
          },
        );
        seen.add(name);
        const ref: Ref = { id: null };
        registry.insuranceByName.set(name, ref);
        plan.insurances.push({
          ref,
          name,
          type,
          insurer: cellToText(value("insurer")) || null,
          method: cellToText(value("method")) || null,
          paymentMethod: cellToText(value("paymentMethod")) || null,
          policyNo: cellToText(value("policyNo")) || null,
          coverageMicros: hasCellValue(value("coverage"))
            ? cellToMicrosString(value("coverage"))
            : null,
          premiumMicros: hasCellValue(value("premium"))
            ? cellToMicrosString(value("premium"))
            : null,
          premiumFreq: cellToText(value("premiumFreq")) || null,
          periods: cellToInt(value("periods")),
          renewal: cellToText(value("renewal")) || null,
          coverageDesc: cellToText(value("coverageDesc")) || null,
          startDate: hasCellValue(value("startDate")) ? cellToDateText(value("startDate")) : null,
          endDate: hasCellValue(value("endDate")) ? cellToDateText(value("endDate")) : null,
          insuredPeopleRefs,
          note: cellToText(value("note")) || null,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseItems(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.items;
    const count = this.ensureCount(counts, "items");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, ITEM_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.itemByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`物品「${name}」在文件中重复`);
        const itemTypeName = cellToText(value("itemType"));
        let itemTypeRef: Ref | null = null;
        if (itemTypeName) {
          const itemType = registry.itemTypeByName.get(itemTypeName);
          if (!itemType)
            throw new Error(`物品类型「${itemTypeName}」不存在（可先在物品类型表新增）`);
          itemTypeRef = itemType;
        }
        seen.add(name);
        const ref: Ref = { id: null };
        registry.itemByName.set(name, ref);
        plan.items.push({
          ref,
          name,
          itemTypeRef,
          purchasePriceMicros: hasCellValue(value("purchasePrice"))
            ? cellToMicrosString(value("purchasePrice"))
            : null,
          purchaseDate: hasCellValue(value("purchaseDate"))
            ? cellToDateText(value("purchaseDate"))
            : null,
          expectedYears: cellToText(value("expectedYears")) || null,
          note: cellToText(value("note")) || null,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseSubscriptionCategories(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.subscriptionCategories;
    const count = this.ensureCount(counts, "subscriptionCategories");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(
      workbook,
      sheetName,
      SUBSCRIPTION_CATEGORY_COLUMNS,
    )) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.subscriptionCategoryByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`订阅分类「${name}」在文件中重复`);
        seen.add(name);
        const ref: Ref = { id: null };
        registry.subscriptionCategoryByName.set(name, ref);
        plan.subscriptionCategories.push({
          ref,
          name,
          icon: cellToText(value("icon")) || null,
          sortOrder: cellToInt(value("sortOrder")) ?? 0,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private parseSubscriptions(
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): void {
    const sheetName = SHEET_NAMES.subscriptions;
    const count = this.ensureCount(counts, "subscriptions");
    const seen = new Set<string>();
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, SUBSCRIPTION_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const name = cellToText(value("name"));
        if (!name) throw new Error("名称不能为空");
        if (registry.subscriptionByName.has(name)) {
          count.matched += 1;
          continue;
        }
        if (seen.has(name)) throw new Error(`订阅「${name}」在文件中重复`);
        const categoryName = cellToText(value("category"));
        let categoryRef: Ref | null = null;
        if (categoryName) {
          const category = registry.subscriptionCategoryByName.get(categoryName);
          if (!category)
            throw new Error(`订阅分类「${categoryName}」不存在（可先在订阅分类表新增）`);
          categoryRef = category;
        }
        const billingText = cellToText(value("billingCycle"));
        const billingCycle = billingText
          ? (valueOfLabel(BILLING_CYCLE_LABELS, billingText) ?? billingText)
          : null;
        seen.add(name);
        const ref: Ref = { id: null };
        registry.subscriptionByName.set(name, ref);
        plan.subscriptions.push({
          ref,
          name,
          categoryRef,
          provider: cellToText(value("provider")) || null,
          planName: cellToText(value("planName")) || null,
          priceMicros: hasCellValue(value("price")) ? cellToMicrosString(value("price")) : null,
          billingCycle,
          paymentMethod: cellToText(value("paymentMethod")) || null,
          autoRenew: cellToText(value("autoRenew")) === "是",
          startDate: hasCellValue(value("startDate")) ? cellToDateText(value("startDate")) : null,
          nextRenewalDate: hasCellValue(value("nextRenewalDate"))
            ? cellToDateText(value("nextRenewalDate"))
            : null,
          note: cellToText(value("note")) || null,
        });
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
  }

  private async parseTransactions(
    ledgerId: string,
    workbook: ExcelJS.Workbook,
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    errors: ImportRowIssue[],
    warnings: ImportRowIssue[],
  ): Promise<void> {
    const sheetName = SHEET_NAMES.transactions;
    const count = this.ensureCount(counts, "transactions");
    const settings = await this.prisma.client.recordSetting.findUnique({ where: { ledgerId } });
    for (const { rowNumber, value } of this.sheetRows(workbook, sheetName, TRANSACTION_COLUMNS)) {
      try {
        if (
          this.classifyRow(sheetName, rowNumber, value("id"), registry, count, warnings) === "skip"
        )
          continue;
        const type = valueOfLabel(TRANSACTION_TYPE_LABELS, cellToText(value("type")));
        if (!type) throw new Error("类型必须是 支出/收入/转账 之一");
        const occurredOn = cellToDateText(value("occurredOn"));
        const grossAmountMicros = toPositiveMicrosString(
          cellToMicrosString(value("amount"), { allowNegative: true }),
        );
        if (BigInt(grossAmountMicros) <= 0n) throw new Error("金额必须大于 0");

        const planned: PlannedTransaction = {
          row: rowNumber,
          type,
          occurredOn,
          grossAmountMicros,
          categoryRef: null,
          subcategoryRef: null,
          accountRef: null,
          subAccountRef: null,
          fromAccountRef: null,
          fromSubAccountRef: null,
          toAccountRef: null,
          toSubAccountRef: null,
          personRef: null,
          insuranceRefs: [],
          itemRefs: [],
          subscriptionRefs: [],
          relations: [],
          note: cellToText(value("note")) || null,
        };

        if (type === "transfer") {
          const from = this.resolveAccountPair(
            registry,
            cellToText(value("fromAccount")),
            cellToText(value("fromSubAccount")),
            "转出",
          );
          const to = this.resolveAccountPair(
            registry,
            cellToText(value("toAccount")),
            cellToText(value("toSubAccount")),
            "转入",
          );
          if (!from || !to) throw new Error("转账必须填写转出账户和转入账户");
          planned.fromAccountRef = from.accountRef;
          planned.fromSubAccountRef = from.subAccountRef;
          planned.toAccountRef = to.accountRef;
          planned.toSubAccountRef = to.subAccountRef;
          if (from.accountRef === to.accountRef && from.subAccountRef === to.subAccountRef) {
            throw new Error("转出和转入账户不能相同");
          }
          if (cellToText(value("relations"))) throw new Error("转账不支持往来关联");
        } else {
          const categoryName = cellToText(value("category"));
          if (categoryName) {
            const categoryKey = `${type}:${categoryName}`;
            const categoryRef = this.resolveOrPlanCategory(
              registry,
              plan,
              counts,
              type,
              categoryName,
            );
            planned.categoryRef = categoryRef;
            const subcategoryName = cellToText(value("subcategory"));
            if (subcategoryName) {
              planned.subcategoryRef = this.resolveOrPlanSubcategory(
                registry,
                plan,
                counts,
                categoryKey,
                categoryRef,
                subcategoryName,
              );
            }
          } else if (cellToText(value("subcategory"))) {
            throw new Error("填写子分类时必须同时填写分类");
          }

          const pair = this.resolveAccountPair(
            registry,
            cellToText(value("account")),
            cellToText(value("subAccount")),
            "",
          );
          if (pair) {
            planned.accountRef = pair.accountRef;
            planned.subAccountRef = pair.subAccountRef;
          } else if (settings?.acctRequired) {
            throw new Error("当前账本要求流水必须填写账户");
          }

          planned.relations = this.parseRelationCell(
            registry,
            type,
            cellToText(value("relations")),
          );
          const relationTotal = planned.relations.reduce(
            (sum, relation) => sum + BigInt(relation.amountMicros),
            0n,
          );
          if (relationTotal > BigInt(grossAmountMicros))
            throw new Error("往来关联金额合计不能超过流水金额");
        }

        const personName = cellToText(value("person"));
        if (personName) {
          planned.personRef = this.resolveOrPlanPerson(registry, plan, counts, personName);
        } else if (settings?.personRequired) {
          throw new Error("当前账本要求流水必须填写成员");
        }

        planned.insuranceRefs = splitNames(cellToText(value("insurance"))).map((insuranceName) => {
          const insurance = registry.insuranceByName.get(insuranceName);
          if (!insurance) throw new Error(`保险「${insuranceName}」不存在（可先在保险表新增）`);
          return insurance;
        });
        planned.itemRefs = splitNames(cellToText(value("item"))).map((itemName) => {
          const item = registry.itemByName.get(itemName);
          if (!item) throw new Error(`物品「${itemName}」不存在（可先在物品表新增）`);
          return item;
        });
        planned.subscriptionRefs = splitNames(cellToText(value("subscription"))).map(
          (subscriptionName) => {
            const subscription = registry.subscriptionByName.get(subscriptionName);
            if (!subscription)
              throw new Error(`订阅「${subscriptionName}」不存在（可先在订阅表新增）`);
            return subscription;
          },
        );

        plan.transactions.push(planned);
        count.new += 1;
      } catch (error) {
        errors.push({ sheet: sheetName, row: rowNumber, message: messageOf(error) });
      }
    }
    if (count.new > IMPORT_MAX_TRANSACTION_ROWS) {
      throw new AppError(
        "IMPORT_TOO_MANY_ROWS",
        `单次导入流水不能超过 ${IMPORT_MAX_TRANSACTION_ROWS} 行`,
        400,
      );
    }
  }

  private resolveOrPlanCategory(
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    type: string,
    name: string,
  ): Ref {
    const key = `${type}:${name}`;
    const existing = registry.categoryByKey.get(key);
    if (existing) return existing;
    const ref: Ref = { id: null };
    registry.categoryByKey.set(key, ref);
    plan.categories.push({ ref, type, name, icon: null, sortOrder: 0 });
    this.ensureCount(counts, "categories").new += 1;
    return ref;
  }

  private resolveOrPlanSubcategory(
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    categoryKey: string,
    categoryRef: Ref,
    name: string,
  ): Ref {
    const key = `${categoryKey}:${name}`;
    const existing = registry.subcategoryByKey.get(key);
    if (existing) return existing;
    const ref: Ref = { id: null };
    registry.subcategoryByKey.set(key, ref);
    plan.subcategories.push({ ref, categoryRef, name, icon: null, sortOrder: 0 });
    this.ensureCount(counts, "subcategories").new += 1;
    return ref;
  }

  private resolveOrPlanPerson(
    registry: Registry,
    plan: Plan,
    counts: ImportResult["counts"],
    name: string,
  ): Ref {
    const existing = registry.personByName.get(name);
    if (existing) return existing;
    const ref: Ref = { id: null };
    registry.personByName.set(name, ref);
    plan.people.push({ ref, name, icon: null });
    this.ensureCount(counts, "people").new += 1;
    return ref;
  }

  private resolveAccountPair(
    registry: Registry,
    accountName: string,
    subAccountName: string,
    label: string,
  ): { accountRef: Ref; subAccountRef: Ref | null } | null {
    if (!accountName) {
      if (subAccountName) throw new Error(`填写${label}子账户时必须同时填写${label}账户`);
      return null;
    }
    const account = registry.accountByName.get(accountName);
    if (!account) throw new Error(`${label}账户「${accountName}」不存在（可先在账户表新增）`);
    if (!["savings", "credit", "invest"].includes(account.type)) {
      throw new Error(`${label}账户只能选择储蓄、信用或投资账户`);
    }
    if (!subAccountName) return { accountRef: account.ref, subAccountRef: null };
    const subAccount = registry.subAccountByKey.get(`${accountName}:${subAccountName}`);
    if (!subAccount)
      throw new Error(`${label}子账户「${subAccountName}」不存在（可先在子账户表新增）`);
    return { accountRef: account.ref, subAccountRef: subAccount };
  }

  /** 往来关联格式：账户名/计入可收回|产生需归还|冲减可收回|冲减需归还/金额元，多条用；分隔。 */
  private parseRelationCell(
    registry: Registry,
    transactionType: string,
    text: string,
  ): PlannedTransaction["relations"] {
    if (!text) return [];
    return text
      .split(/[；;]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const segments = part.split("/").map((segment) => segment.trim());
        if (segments.length !== 3)
          throw new Error(`往来关联「${part}」格式无效，应为 账户名/计入可收回/金额`);
        const [accountName, relationKindLabel, amountText] = segments as [string, string, string];
        const relationKind = valueOfLabel(RELATION_KIND_LABELS, relationKindLabel);
        if (!relationKind) {
          throw new Error(
            `往来关联类型「${relationKindLabel}」无效，应为 计入可收回、产生需归还、冲减可收回 或 冲减需归还`,
          );
        }
        if (
          transactionType === "expense" &&
          !["receivable_from_expense", "payable_from_expense"].includes(relationKind)
        ) {
          throw new Error(`支出不支持往来关联类型「${relationKindLabel}」`);
        }
        if (
          transactionType === "income" &&
          !["payable_from_income", "receivable_from_income"].includes(relationKind)
        ) {
          throw new Error(`收入不支持往来关联类型「${relationKindLabel}」`);
        }
        const account = registry.accountByName.get(accountName);
        if (!account) throw new Error(`往来账户「${accountName}」不存在（可先在账户表新增）`);
        const expectedType = relationKind.startsWith("receivable") ? "receivable" : "payable";
        if (account.type !== expectedType) {
          throw new Error(`往来账户「${accountName}」类型与「${relationKindLabel}」不匹配`);
        }
        const amountMicros = cellToMicrosString(amountText);
        if (BigInt(amountMicros) <= 0n) throw new Error("往来关联金额必须大于 0");
        return {
          accountRef: account.ref,
          relationKind,
          amountMicros,
        };
      });
  }

  /** 提交阶段：单事务内先建基础数据（回填 ref.id），再逐行走交易服务复用记账逻辑。 */
  private async commit(
    ledgerId: string,
    userId: string,
    plan: Plan,
    counts: ImportResult["counts"],
  ): Promise<void> {
    const batchId = randomUUID();
    await this.txs.run(async (tx) => {
      await this.createBaseEntities(tx, ledgerId, userId, plan);
      for (const planned of plan.transactions) {
        const created = await this.transactions.createInsideExistingTransactionLight(
          tx,
          ledgerId,
          userId,
          {
            type: planned.type,
            grossAmountMicros: planned.grossAmountMicros,
            occurredOn: planned.occurredOn,
            categoryId: refId(planned.categoryRef),
            subcategoryId: refId(planned.subcategoryRef),
            personId: refId(planned.personRef),
            accountId: refId(planned.accountRef),
            subAccountId: refId(planned.subAccountRef),
            fromAccountId: refId(planned.fromAccountRef),
            fromSubAccountId: refId(planned.fromSubAccountRef),
            toAccountId: refId(planned.toAccountRef),
            toSubAccountId: refId(planned.toSubAccountRef),
            note: planned.note ?? undefined,
            relations: planned.relations.map((relation) => ({
              accountId: relation.accountRef.id!,
              relationKind: relation.relationKind,
              amountMicros: relation.amountMicros,
            })),
          },
          { source: "import", sourceId: batchId, auditAction: "transaction.import" },
        );
        // CreateTransactionDto 不含保险/物品关联，链接需在交易创建后单独写入。
        for (const linked of [
          ...planned.insuranceRefs.map((ref) => ({
            linkedType: "insurance",
            linkedId: ref.id!,
            linkKind: "related",
          })),
          ...planned.itemRefs.map((ref) => ({
            linkedType: "item",
            linkedId: ref.id!,
            linkKind: "consumable",
          })),
          ...planned.subscriptionRefs.map((ref) => ({
            linkedType: "subscription",
            linkedId: ref.id!,
            linkKind: "related",
          })),
        ]) {
          await tx.transactionLink.upsert({
            where: {
              transactionId_linkedType_linkedId: {
                transactionId: created.id,
                linkedType: linked.linkedType,
                linkedId: linked.linkedId,
              },
            },
            create: { ledgerId, transactionId: created.id, ...linked },
            update: { linkKind: linked.linkKind },
          });
        }
      }
      await this.audit.write(
        {
          source: "user",
          actorUserId: userId,
          ledgerId,
          action: "ledger.import_excel",
          entityType: "ledger",
          entityId: ledgerId,
          metadata: { batchId, counts },
        },
        tx,
      );
    }, BULK_TX_OPTIONS);
  }

  private async createBaseEntities(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
    plan: Plan,
  ): Promise<void> {
    for (const planned of plan.itemTypes) {
      const created = await tx.itemType.create({
        data: { ledgerId, name: planned.name, sortOrder: planned.sortOrder },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.people) {
      const created = await tx.person.upsert({
        where: { ledgerId_name: { ledgerId, name: planned.name } },
        create: {
          ledgerId,
          name: planned.name,
          icon: planned.icon,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          archivedAt: null,
          icon: planned.icon,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.categories) {
      const created = await tx.category.upsert({
        where: { ledgerId_type_name: { ledgerId, type: planned.type, name: planned.name } },
        create: {
          ledgerId,
          type: planned.type,
          name: planned.name,
          icon: planned.icon,
          sortOrder: planned.sortOrder,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          archivedAt: null,
          icon: planned.icon,
          sortOrder: planned.sortOrder,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.subcategories) {
      const created = await tx.subcategory.upsert({
        where: { categoryId_name: { categoryId: planned.categoryRef.id!, name: planned.name } },
        create: {
          ledgerId,
          categoryId: planned.categoryRef.id!,
          name: planned.name,
          icon: planned.icon,
          sortOrder: planned.sortOrder,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          archivedAt: null,
          icon: planned.icon,
          sortOrder: planned.sortOrder,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.accounts) {
      const balanceMicros = BigInt(planned.balanceMicros);
      const created = await tx.account.create({
        data: {
          ledgerId,
          type: planned.type,
          name: planned.name,
          icon: planned.icon,
          balanceMicros,
          includeInNetWorth: planned.includeInNetWorth,
          creditLimitMicros: planned.creditLimitMicros ? BigInt(planned.creditLimitMicros) : null,
          counterparty: planned.counterparty,
          billDay: planned.billDay,
          repayDay: planned.repayDay,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
      // money 账户自动生成默认子账户，承接未指定子账户的导入记账（与 AccountsService.create 一致）。
      if (["savings", "credit", "invest"].includes(planned.type)) {
        await tx.subAccount.create({
          data: {
            ledgerId,
            accountId: created.id,
            name: "默认",
            icon: planned.icon,
            balanceMicros,
            includeInNetWorth: planned.includeInNetWorth,
            isDefault: true,
            createdBy: userId,
            updatedBy: userId,
          },
        });
      }
    }
    for (const planned of plan.subAccounts) {
      const balanceMicros = BigInt(planned.balanceMicros);
      const created = await tx.subAccount.create({
        data: {
          ledgerId,
          accountId: planned.accountRef.id!,
          name: planned.name,
          icon: planned.icon,
          balanceMicros,
          includeInNetWorth: planned.includeInNetWorth,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      // 子账户余额计入父账户（与 AccountsService.createSubAccountInner 保持一致）。
      if (balanceMicros !== 0n) {
        await tx.account.update({
          where: { id: planned.accountRef.id! },
          data: { balanceMicros: { increment: balanceMicros }, updatedBy: userId },
        });
      }
      planned.ref.id = created.id;
    }
    for (const planned of plan.insurances) {
      const created = await tx.insurance.create({
        data: {
          ledgerId,
          type: planned.type,
          name: planned.name,
          insurer: planned.insurer,
          method: planned.method,
          paymentMethod: planned.paymentMethod,
          policyNo: planned.policyNo,
          coverageMicros: planned.coverageMicros ? BigInt(planned.coverageMicros) : null,
          premiumMicros: planned.premiumMicros ? BigInt(planned.premiumMicros) : null,
          premiumFreq: planned.premiumFreq,
          periods: planned.periods,
          renewal: planned.renewal,
          coverageDesc: planned.coverageDesc,
          startDate: planned.startDate ? parseDateOnly(planned.startDate) : null,
          endDate: planned.endDate ? parseDateOnly(planned.endDate) : null,
          note: planned.note,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
      if (planned.insuredPeopleRefs.length) {
        await tx.insuranceInsuredPerson.createMany({
          data: planned.insuredPeopleRefs.map((personRef) => ({
            insuranceId: created.id,
            personId: personRef.id!,
          })),
        });
      }
    }
    for (const planned of plan.items) {
      const created = await tx.item.create({
        data: {
          ledgerId,
          name: planned.name,
          typeId: planned.itemTypeRef?.id ?? null,
          purchasePriceMicros: planned.purchasePriceMicros
            ? BigInt(planned.purchasePriceMicros)
            : null,
          purchaseDate: planned.purchaseDate ? parseDateOnly(planned.purchaseDate) : null,
          expectedYears: planned.expectedYears ?? null,
          note: planned.note,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.subscriptionCategories) {
      const created = await tx.subscriptionCategory.create({
        data: {
          ledgerId,
          name: planned.name,
          icon: planned.icon,
          sortOrder: planned.sortOrder,
        },
      });
      planned.ref.id = created.id;
    }
    for (const planned of plan.subscriptions) {
      const created = await tx.subscription.create({
        data: {
          ledgerId,
          name: planned.name,
          categoryId: planned.categoryRef?.id ?? null,
          provider: planned.provider,
          planName: planned.planName,
          priceMicros: planned.priceMicros ? BigInt(planned.priceMicros) : null,
          billingCycle: planned.billingCycle,
          paymentMethod: planned.paymentMethod,
          autoRenew: planned.autoRenew,
          startDate: planned.startDate ? parseDateOnly(planned.startDate) : null,
          nextRenewalDate: planned.nextRenewalDate ? parseDateOnly(planned.nextRenewalDate) : null,
          note: planned.note,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      planned.ref.id = created.id;
    }
  }
}

function refId(ref: Ref | null): string | undefined {
  return ref?.id ?? undefined;
}

function toPositiveMicrosString(micros: string): string {
  const value = BigInt(micros);
  return (value < 0n ? -value : value).toString();
}

function hasCellValue(value: unknown): boolean {
  return cellToText(value) !== "";
}

function splitNames(text: string): string[] {
  return text
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
