import { Injectable } from "@nestjs/common";
import { PrismaService } from "@fin-nest/backend";
import ExcelJS from "exceljs";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_TYPE_LABELS,
  BILLING_CYCLE_LABELS,
  BOOLEAN_LABELS,
  BUDGET_COLUMNS,
  CATEGORY_COLUMNS,
  CATEGORY_TYPE_LABELS,
  ColumnDef,
  dateToText,
  INSURANCE_COLUMNS,
  ITEM_COLUMNS,
  ITEM_TYPE_COLUMNS,
  labelOf,
  microsToYuanNumber,
  PERSON_COLUMNS,
  PLAN_COLUMNS,
  RELATION_KIND_LABELS,
  SHEET_NAMES,
  SUB_ACCOUNT_COLUMNS,
  SUBCATEGORY_COLUMNS,
  SUBSCRIPTION_CATEGORY_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  TRANSACTION_COLUMNS,
  TRANSACTION_TYPE_LABELS,
} from "./excel-schema";

const TEMPLATE_VALIDATION_ROWS = 500;
const MONEY_FORMAT = "0.00";

type LedgerData = Awaited<ReturnType<ExcelExportService["loadLedgerData"]>>;

@Injectable()
export class ExcelExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
  ) {}

  async buildWorkbook(
    ledgerId: string,
    userId: string,
    options: { template: boolean },
  ): Promise<Buffer> {
    await this.ledgers.assertMember(ledgerId, userId);
    const data = await this.loadLedgerData(ledgerId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "fin-nest";
    workbook.created = new Date();

    this.addReadmeSheet(workbook, options.template);
    const transactionSheet = this.addTransactionsSheet(workbook, data, options.template);
    this.addCategoriesSheet(workbook, data);
    this.addSubcategoriesSheet(workbook, data);
    this.addPeopleSheet(workbook, data);
    this.addAccountsSheet(workbook, data);
    this.addSubAccountsSheet(workbook, data);
    this.addInsurancesSheet(workbook, data);
    this.addItemsSheet(workbook, data);
    this.addItemTypesSheet(workbook, data);
    this.addSubscriptionsSheet(workbook, data);
    this.addSubscriptionCategoriesSheet(workbook, data);
    if (!options.template) {
      this.addPlansSheet(workbook, data);
      this.addBudgetsSheet(workbook, data);
    }
    if (options.template) {
      this.addLookupSheetAndValidations(workbook, transactionSheet, data);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** 名称映射需要含归档/软删行（老流水可能引用它们），基础 sheet 只列活跃行。 */
  private async loadLedgerData(ledgerId: string) {
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
      relations,
      links,
      plans,
      budgetSetting,
      categoryBudgets,
      insuredPeople,
    ] = await Promise.all([
      client.category.findMany({
        where,
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      client.subcategory.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      client.person.findMany({ where, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
      client.account.findMany({ where, orderBy: [{ type: "asc" }, { createdAt: "asc" }] }),
      client.subAccount.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.insurance.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.item.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.itemType.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      client.subscription.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.subscriptionCategory.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      client.transaction.findMany({
        where: { ledgerId, deletedAt: null },
        orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
      }),
      client.transactionAccountRelation.findMany({ where }),
      client.transactionLink.findMany({ where }),
      client.plan.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: { createdAt: "asc" },
      }),
      client.budgetSetting.findUnique({ where: { ledgerId } }),
      client.categoryBudget.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.insuranceInsuredPerson.findMany({}),
    ]);

    const categoryById = new Map(categories.map((row) => [row.id, row]));
    const subcategoryById = new Map(subcategories.map((row) => [row.id, row]));
    const personById = new Map(people.map((row) => [row.id, row]));
    const accountById = new Map(accounts.map((row) => [row.id, row]));
    const subAccountById = new Map(subAccounts.map((row) => [row.id, row]));
    const insuranceById = new Map(insurances.map((row) => [row.id, row]));
    const itemById = new Map(items.map((row) => [row.id, row]));
    const itemTypeById = new Map(itemTypes.map((row) => [row.id, row]));
    const subscriptionById = new Map(subscriptions.map((row) => [row.id, row]));
    const subscriptionCategoryById = new Map(subscriptionCategories.map((row) => [row.id, row]));

    const relationsByTransaction = new Map<string, typeof relations>();
    for (const relation of relations) {
      const list = relationsByTransaction.get(relation.transactionId) ?? [];
      list.push(relation);
      relationsByTransaction.set(relation.transactionId, list);
    }
    const linksByTransaction = new Map<string, typeof links>();
    for (const link of links) {
      const list = linksByTransaction.get(link.transactionId) ?? [];
      list.push(link);
      linksByTransaction.set(link.transactionId, list);
    }
    const insuranceIds = new Set(insurances.map((row) => row.id));
    const insuredPeopleByInsurance = new Map<string, string[]>();
    for (const row of insuredPeople) {
      if (!insuranceIds.has(row.insuranceId)) continue;
      const names = insuredPeopleByInsurance.get(row.insuranceId) ?? [];
      const person = personById.get(row.personId);
      if (person) names.push(person.name);
      insuredPeopleByInsurance.set(row.insuranceId, names);
    }

    return {
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
      plans,
      budgetSetting,
      categoryBudgets,
      categoryById,
      subcategoryById,
      personById,
      accountById,
      subAccountById,
      insuranceById,
      itemById,
      itemTypeById,
      subscriptionById,
      subscriptionCategoryById,
      relationsByTransaction,
      linksByTransaction,
      insuredPeopleByInsurance,
    };
  }

  private addSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    columns: ColumnDef[],
  ): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? 12,
    }));
    sheet.getRow(1).font = { bold: true };
    return sheet;
  }

  private addReadmeSheet(workbook: ExcelJS.Workbook, template: boolean): void {
    const sheet = workbook.addWorksheet(SHEET_NAMES.readme);
    sheet.getColumn(1).width = 110;
    const lines = [
      template
        ? "fin-nest 记账模板（可在 Excel 中记账后导入）"
        : "fin-nest 账本导出（可在 Excel 中继续记账后导入）",
      "",
      "使用说明：",
      "1. 每个工作表第一列都是 ID：由系统导出的行带有 ID，请勿修改；你新增的行请将 ID 留空，导入时会识别为新增。",
      "2. 已有行（带 ID）的修改和删除不会同步回账本，导入只处理新增行。",
      "3. 日期格式：YYYY-MM-DD（如 2026-07-03）。金额单位为元，最多 2 位小数。",
      "4. 「流水」表按名称引用其他表：分类、子分类、账户、成员、保险、物品等填对应名称即可；" +
        "名称可以是账本里已有的，也可以是本文件其他表里新增的行。",
      "5. 流水类型：支出 / 收入 / 转账。支出收入填「账户」，转账填「转出账户」「转入账户」。",
      "6. 「往来关联」用于支出里可收回、收入里需归还等场景，格式：账户名/可收回/金额，多条用中文分号；分隔。" +
        "示例：张三借款/可收回/200（要求该账户是可收回或需归还类型）。",
      "7. 「关联保险」「关联物品」填对应名称，多个用中文顿号、分隔。",
      "8. 新增账户可填「余额(元)」作为期初余额；新增子账户的余额同样为期初余额。",
      "9. 「计划」「预算」表仅导出查看，导入时忽略。",
      "10. 导入时任何一行有错误，整个文件都不会导入；请根据错误提示修正后重试。",
    ];
    for (const line of lines) sheet.addRow([line]);
    sheet.getRow(1).font = { bold: true, size: 14 };
  }

  private addTransactionsSheet(
    workbook: ExcelJS.Workbook,
    data: LedgerData,
    template: boolean,
  ): ExcelJS.Worksheet {
    const sheet = this.addSheet(workbook, SHEET_NAMES.transactions, TRANSACTION_COLUMNS);
    if (template) return sheet;
    for (const transaction of data.transactions) {
      const category = transaction.categoryId
        ? data.categoryById.get(transaction.categoryId)
        : null;
      const subcategory = transaction.subcategoryId
        ? data.subcategoryById.get(transaction.subcategoryId)
        : null;
      const relationText = (data.relationsByTransaction.get(transaction.id) ?? [])
        .map((relation) => {
          const account = data.accountById.get(relation.accountId);
          return `${account?.name ?? ""}/${RELATION_KIND_LABELS[relation.relationKind] ?? relation.relationKind}/${microsToYuanNumber(relation.amountMicros)}`;
        })
        .join("；");
      const linkRows = data.linksByTransaction.get(transaction.id) ?? [];
      const insuranceNames = linkRows
        .filter((link) => link.linkedType === "insurance")
        .map((link) => data.insuranceById.get(link.linkedId)?.name ?? "")
        .filter(Boolean)
        .join("、");
      const itemNames = linkRows
        .filter((link) => link.linkedType === "item")
        .map((link) => data.itemById.get(link.linkedId)?.name ?? "")
        .filter(Boolean)
        .join("、");
      const subscriptionNames = linkRows
        .filter((link) => link.linkedType === "subscription")
        .map((link) => data.subscriptionById.get(link.linkedId)?.name ?? "")
        .filter(Boolean)
        .join("、");
      const row = sheet.addRow({
        id: transaction.id,
        occurredOn: dateToText(transaction.occurredOn),
        type: labelOf(TRANSACTION_TYPE_LABELS, transaction.type),
        amount: microsToYuanNumber(transaction.grossAmountMicros),
        category: category?.name ?? "",
        subcategory: subcategory?.name ?? "",
        account: transaction.accountId
          ? (data.accountById.get(transaction.accountId)?.name ?? "")
          : "",
        subAccount: transaction.subAccountId
          ? (data.subAccountById.get(transaction.subAccountId)?.name ?? "")
          : "",
        fromAccount: transaction.fromAccountId
          ? (data.accountById.get(transaction.fromAccountId)?.name ?? "")
          : "",
        fromSubAccount: transaction.fromSubAccountId
          ? (data.subAccountById.get(transaction.fromSubAccountId)?.name ?? "")
          : "",
        toAccount: transaction.toAccountId
          ? (data.accountById.get(transaction.toAccountId)?.name ?? "")
          : "",
        toSubAccount: transaction.toSubAccountId
          ? (data.subAccountById.get(transaction.toSubAccountId)?.name ?? "")
          : "",
        person: transaction.personId ? (data.personById.get(transaction.personId)?.name ?? "") : "",
        insurance: insuranceNames,
        item: itemNames,
        subscription: subscriptionNames,
        relations: relationText,
        note: transaction.note ?? "",
      });
      row.getCell("amount").numFmt = MONEY_FORMAT;
    }
    return sheet;
  }

  private addCategoriesSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.categories, CATEGORY_COLUMNS);
    for (const category of data.categories) {
      if (category.archivedAt) continue;
      sheet.addRow({
        id: category.id,
        type: labelOf(CATEGORY_TYPE_LABELS, category.type),
        name: category.name,
        icon: category.icon ?? "",
        sortOrder: category.sortOrder,
      });
    }
  }

  private addSubcategoriesSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.subcategories, SUBCATEGORY_COLUMNS);
    for (const subcategory of data.subcategories) {
      if (subcategory.archivedAt) continue;
      const category = data.categoryById.get(subcategory.categoryId);
      sheet.addRow({
        id: subcategory.id,
        categoryType: labelOf(CATEGORY_TYPE_LABELS, category?.type),
        category: category?.name ?? "",
        name: subcategory.name,
        icon: subcategory.icon ?? "",
        sortOrder: subcategory.sortOrder,
      });
    }
  }

  private addPeopleSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.people, PERSON_COLUMNS);
    for (const person of data.people) {
      if (person.archivedAt) continue;
      sheet.addRow({ id: person.id, name: person.name, icon: person.icon ?? "" });
    }
  }

  private addAccountsSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.accounts, ACCOUNT_COLUMNS);
    for (const account of data.accounts) {
      if (account.archivedAt) continue;
      const row = sheet.addRow({
        id: account.id,
        type: labelOf(ACCOUNT_TYPE_LABELS, account.type),
        name: account.name,
        icon: account.icon ?? "",
        balance: microsToYuanNumber(account.balanceMicros),
        includeInNetWorth: labelOf(BOOLEAN_LABELS, String(account.includeInNetWorth)),
        creditLimit: microsToYuanNumber(account.creditLimitMicros),
        counterparty: account.counterparty ?? "",
        billDay: account.billDay ?? "",
        repayDay: account.repayDay ?? "",
      });
      row.getCell("balance").numFmt = MONEY_FORMAT;
      row.getCell("creditLimit").numFmt = MONEY_FORMAT;
    }
  }

  private addSubAccountsSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.subAccounts, SUB_ACCOUNT_COLUMNS);
    for (const subAccount of data.subAccounts) {
      if (subAccount.archivedAt) continue;
      const account = data.accountById.get(subAccount.accountId);
      if (account?.archivedAt) continue;
      const row = sheet.addRow({
        id: subAccount.id,
        account: account?.name ?? "",
        name: subAccount.name,
        icon: subAccount.icon ?? "",
        balance: microsToYuanNumber(subAccount.balanceMicros),
        includeInNetWorth: labelOf(BOOLEAN_LABELS, String(subAccount.includeInNetWorth)),
      });
      row.getCell("balance").numFmt = MONEY_FORMAT;
    }
  }

  private addInsurancesSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.insurances, INSURANCE_COLUMNS);
    for (const insurance of data.insurances) {
      if (insurance.deletedAt) continue;
      const row = sheet.addRow({
        id: insurance.id,
        name: insurance.name,
        type: insurance.type,
        insurer: insurance.insurer ?? "",
        method: insurance.method ?? "",
        paymentMethod: insurance.paymentMethod ?? "",
        policyNo: insurance.policyNo ?? "",
        coverage: microsToYuanNumber(insurance.coverageMicros),
        premium: microsToYuanNumber(insurance.premiumMicros),
        premiumFreq: insurance.premiumFreq ?? "",
        periods: insurance.periods ?? "",
        renewal: insurance.renewal ?? "",
        coverageDesc: insurance.coverageDesc ?? "",
        startDate: dateToText(insurance.startDate),
        endDate: dateToText(insurance.endDate),
        insuredPeople: (data.insuredPeopleByInsurance.get(insurance.id) ?? []).join("、"),
        note: insurance.note ?? "",
      });
      row.getCell("coverage").numFmt = MONEY_FORMAT;
      row.getCell("premium").numFmt = MONEY_FORMAT;
    }
  }

  private addItemsSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.items, ITEM_COLUMNS);
    for (const item of data.items) {
      if (item.deletedAt) continue;
      const row = sheet.addRow({
        id: item.id,
        name: item.name,
        itemType: item.typeId ? (data.itemTypeById.get(item.typeId)?.name ?? "") : "",
        purchasePrice: microsToYuanNumber(item.purchasePriceMicros),
        purchaseDate: dateToText(item.purchaseDate),
        expectedYears: item.expectedYears == null ? "" : Number(item.expectedYears),
        note: item.note ?? "",
      });
      row.getCell("purchasePrice").numFmt = MONEY_FORMAT;
    }
  }

  private addItemTypesSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.itemTypes, ITEM_TYPE_COLUMNS);
    for (const itemType of data.itemTypes) {
      sheet.addRow({ id: itemType.id, name: itemType.name, sortOrder: itemType.sortOrder });
    }
  }

  private addSubscriptionsSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.subscriptions, SUBSCRIPTION_COLUMNS);
    for (const subscription of data.subscriptions) {
      if (subscription.deletedAt) continue;
      const row = sheet.addRow({
        id: subscription.id,
        name: subscription.name,
        category: subscription.categoryId
          ? (data.subscriptionCategoryById.get(subscription.categoryId)?.name ?? "")
          : "",
        provider: subscription.provider ?? "",
        planName: subscription.planName ?? "",
        price: microsToYuanNumber(subscription.priceMicros),
        billingCycle: labelOf(BILLING_CYCLE_LABELS, subscription.billingCycle),
        paymentMethod: subscription.paymentMethod ?? "",
        autoRenew: labelOf(BOOLEAN_LABELS, String(subscription.autoRenew)),
        startDate: dateToText(subscription.startDate),
        nextRenewalDate: dateToText(subscription.nextRenewalDate),
        note: subscription.note ?? "",
      });
      row.getCell("price").numFmt = MONEY_FORMAT;
    }
  }

  private addSubscriptionCategoriesSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(
      workbook,
      SHEET_NAMES.subscriptionCategories,
      SUBSCRIPTION_CATEGORY_COLUMNS,
    );
    for (const category of data.subscriptionCategories) {
      sheet.addRow({
        id: category.id,
        name: category.name,
        icon: category.icon ?? "",
        sortOrder: category.sortOrder,
      });
    }
  }

  private addPlansSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.plans, PLAN_COLUMNS);
    for (const plan of data.plans) {
      const row = sheet.addRow({
        id: plan.id,
        kind: plan.kind,
        metric: plan.metric,
        name: plan.name,
        limitAmount: microsToYuanNumber(plan.limitAmountMicros),
        limitCount: plan.limitCount ?? "",
        startDate: dateToText(plan.startDate),
        repeatRule: plan.repeatRule,
      });
      row.getCell("limitAmount").numFmt = MONEY_FORMAT;
    }
  }

  private addBudgetsSheet(workbook: ExcelJS.Workbook, data: LedgerData): void {
    const sheet = this.addSheet(workbook, SHEET_NAMES.budgets, BUDGET_COLUMNS);
    if (data.budgetSetting?.totalAmountMicros != null) {
      const row = sheet.addRow({
        id: "",
        category: "(总预算)",
        amount: microsToYuanNumber(data.budgetSetting.totalAmountMicros),
      });
      row.getCell("amount").numFmt = MONEY_FORMAT;
    }
    for (const budget of data.categoryBudgets) {
      const row = sheet.addRow({
        id: budget.id,
        category: data.categoryById.get(budget.categoryId)?.name ?? "",
        amount: microsToYuanNumber(budget.amountMicros),
      });
      row.getCell("amount").numFmt = MONEY_FORMAT;
    }
  }

  /** 模板模式：隐藏「基础数据」sheet 提供下拉数据源，流水表前 N 行挂 list 校验。 */
  private addLookupSheetAndValidations(
    workbook: ExcelJS.Workbook,
    transactionSheet: ExcelJS.Worksheet,
    data: LedgerData,
  ): void {
    const lookup = workbook.addWorksheet(SHEET_NAMES.lookup, { state: "veryHidden" });
    const moneyAccounts = data.accounts.filter(
      (account) => !account.archivedAt && ["savings", "credit", "invest"].includes(account.type),
    );
    const lists: { column: string; values: string[] }[] = [
      { column: "A", values: Object.values(TRANSACTION_TYPE_LABELS) },
      {
        column: "B",
        values: data.categories.filter((row) => !row.archivedAt).map((row) => row.name),
      },
      { column: "C", values: moneyAccounts.map((row) => row.name) },
      { column: "D", values: data.people.filter((row) => !row.archivedAt).map((row) => row.name) },
      {
        column: "E",
        values: data.insurances.filter((row) => !row.deletedAt).map((row) => row.name),
      },
      { column: "F", values: data.items.filter((row) => !row.deletedAt).map((row) => row.name) },
    ];
    for (const list of lists) {
      list.values.forEach((value, index) => {
        lookup.getCell(`${list.column}${index + 1}`).value = value;
      });
    }
    const rangeRef = (column: string, count: number): string | null =>
      count > 0 ? `${SHEET_NAMES.lookup}!$${column}$1:$${column}$${count}` : null;

    const validations: { key: string; formula: string | null }[] = [
      { key: "type", formula: `"${Object.values(TRANSACTION_TYPE_LABELS).join(",")}"` },
      { key: "category", formula: rangeRef("B", lists[1]!.values.length) },
      { key: "account", formula: rangeRef("C", lists[2]!.values.length) },
      { key: "fromAccount", formula: rangeRef("C", lists[2]!.values.length) },
      { key: "toAccount", formula: rangeRef("C", lists[2]!.values.length) },
      { key: "person", formula: rangeRef("D", lists[3]!.values.length) },
      { key: "insurance", formula: rangeRef("E", lists[4]!.values.length) },
      { key: "item", formula: rangeRef("F", lists[5]!.values.length) },
    ];
    for (const validation of validations) {
      if (!validation.formula) continue;
      const columnIndex =
        TRANSACTION_COLUMNS.findIndex((column) => column.key === validation.key) + 1;
      const columnLetter = transactionSheet.getColumn(columnIndex).letter;
      for (let rowNumber = 2; rowNumber <= TEMPLATE_VALIDATION_ROWS + 1; rowNumber += 1) {
        transactionSheet.getCell(`${columnLetter}${rowNumber}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [validation.formula],
          showErrorMessage: false,
        };
      }
    }
    // 日期列给出格式提示。
    const dateColumnIndex =
      TRANSACTION_COLUMNS.findIndex((column) => column.key === "occurredOn") + 1;
    transactionSheet.getColumn(dateColumnIndex).numFmt = "yyyy-mm-dd";
  }
}
