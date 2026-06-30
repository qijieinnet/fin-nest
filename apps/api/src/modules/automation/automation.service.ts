import { Injectable } from "@nestjs/common";
import {
  AppError,
  BackgroundJobsService,
  DatabaseTransactionService,
  dateKey,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
  todayKey,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { LedgersService } from "../ledgers/ledgers.service";
import { CreateTransactionDto } from "../transactions/dto/create-transaction.dto";
import { TransactionsService } from "../transactions/transactions.service";
import { ListAutoPendingQueryDto, UpdateAutoPendingDto } from "./dto/auto-pending.dto";
import { CreateAutoRuleDto, UpdateAutoRuleDto } from "./dto/auto-rule.dto";
import { CreateQuickTemplateDto, UpdateQuickTemplateDto } from "./dto/quick-template.dto";

type AutoPayload = {
  accountId?: string | null;
  categoryId?: string | null;
  fromAccountId?: string | null;
  fromSubAccountId?: string | null;
  personId?: string | null;
  subAccountId?: string | null;
  subcategoryId?: string | null;
  toAccountId?: string | null;
  toSubAccountId?: string | null;
};

type AccountPair = {
  accountId: string | null;
  subAccountId: string | null;
};

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly jobs: BackgroundJobsService,
    private readonly ledgers: LedgersService,
    private readonly transactions: TransactionsService,
  ) {}

  async listRules(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.autoRule.findMany({
      where: { ledgerId, archivedAt: null },
      orderBy: [{ enabled: "desc" }, { nextRunOn: "asc" }, { createdAt: "asc" }],
    });
  }

  async createRule(ledgerId: string, userId: string, input: CreateAutoRuleDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAutoPayload(ledgerId, input.type, input);
    return this.txs.run(async (tx) => {
      const startDate = parseDateOnly(input.startDate);
      const isTransfer = input.type === "transfer";
      const rule = await tx.autoRule.create({
        data: {
          ledgerId,
          enabled: input.enabled ?? true,
          type: input.type,
          amountMicros: BigInt(input.amountMicros),
          categoryId: isTransfer ? null : input.categoryId!,
          subcategoryId: isTransfer ? null : (input.subcategoryId ?? null),
          accountId: isTransfer ? null : (input.accountId ?? null),
          subAccountId: isTransfer ? null : (input.subAccountId ?? null),
          fromAccountId: isTransfer ? input.fromAccountId! : null,
          fromSubAccountId: isTransfer ? (input.fromSubAccountId ?? null) : null,
          toAccountId: isTransfer ? input.toAccountId! : null,
          toSubAccountId: isTransfer ? (input.toSubAccountId ?? null) : null,
          personId: isTransfer ? null : (input.personId ?? null),
          note: input.note ?? null,
          repeatRule: input.repeatRule,
          startDate,
          nextRunOn: input.enabled === false ? null : startDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.jobs.enqueue(
        { type: "auto.schedule", payload: { ledgerId }, runAfter: startDate },
        tx,
      );
      return rule;
    });
  }

  async updateRule(ledgerId: string, ruleId: string, userId: string, input: UpdateAutoRuleDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.assertRule(ledgerId, ruleId);
    const type = input.type ?? existing.type;
    const account = this.mergeAccountPair(
      { accountId: existing.accountId, subAccountId: existing.subAccountId },
      { accountId: input.accountId, subAccountId: input.subAccountId },
    );
    const fromAccount = this.mergeAccountPair(
      { accountId: existing.fromAccountId, subAccountId: existing.fromSubAccountId },
      { accountId: input.fromAccountId, subAccountId: input.fromSubAccountId },
    );
    const toAccount = this.mergeAccountPair(
      { accountId: existing.toAccountId, subAccountId: existing.toSubAccountId },
      { accountId: input.toAccountId, subAccountId: input.toSubAccountId },
    );
    await this.assertAutoPayload(ledgerId, type, {
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      subcategoryId: input.categoryId !== undefined && input.subcategoryId === undefined
        ? null
        : input.subcategoryId === undefined
          ? existing.subcategoryId
          : input.subcategoryId,
      accountId: account.accountId,
      subAccountId: account.subAccountId,
      fromAccountId: fromAccount.accountId,
      fromSubAccountId: fromAccount.subAccountId,
      toAccountId: toAccount.accountId,
      toSubAccountId: toAccount.subAccountId,
      personId: input.personId === undefined ? existing.personId : input.personId,
    });
    return this.txs.run(async (tx) => {
      const enabled = input.enabled ?? existing.enabled;
      const startDate = input.startDate ? parseDateOnly(input.startDate) : existing.startDate;
      const repeatRule = input.repeatRule ?? existing.repeatRule;
      const scheduleChanged =
        (input.enabled !== undefined && input.enabled !== existing.enabled) ||
        input.startDate !== undefined ||
        input.repeatRule !== undefined;
      const nextRunOn = scheduleChanged ? (enabled ? startDate : null) : undefined;
      const rule = await tx.autoRule.update({
        where: { id: ruleId },
        data: {
          type: input.type,
          enabled: input.enabled,
          amountMicros: input.amountMicros === undefined ? undefined : BigInt(input.amountMicros),
          categoryId: type === "transfer" ? null : input.categoryId,
          subcategoryId:
            type === "transfer"
              ? null
              : input.categoryId !== undefined && input.subcategoryId === undefined
                ? null
                : input.subcategoryId,
          accountId: type === "transfer" ? null : input.accountId,
          subAccountId:
            type === "transfer"
              ? null
              : input.accountId !== undefined && input.subAccountId === undefined
                ? null
                : input.subAccountId,
          fromAccountId: type === "transfer" ? input.fromAccountId : null,
          fromSubAccountId:
            type === "transfer"
              ? input.fromAccountId !== undefined && input.fromSubAccountId === undefined
                ? null
                : input.fromSubAccountId
              : null,
          toAccountId: type === "transfer" ? input.toAccountId : null,
          toSubAccountId:
            type === "transfer"
              ? input.toAccountId !== undefined && input.toSubAccountId === undefined
                ? null
                : input.toSubAccountId
              : null,
          personId: type === "transfer" ? null : input.personId,
          note: input.note,
          repeatRule: input.repeatRule,
          startDate: input.startDate ? startDate : undefined,
          nextRunOn,
          updatedBy: userId,
        },
      });
      if (scheduleChanged && enabled)
        await this.jobs.enqueue(
          { type: "auto.schedule", payload: { ledgerId }, runAfter: startDate },
          tx,
        );
      return { ...rule, repeatRule };
    });
  }

  async archiveRule(ledgerId: string, ruleId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertRule(ledgerId, ruleId);
    await this.prisma.client.autoRule.update({
      where: { id: ruleId },
      data: { archivedAt: new Date(), enabled: false, nextRunOn: null, updatedBy: userId },
    });
  }

  async listPending(ledgerId: string, userId: string, query: ListAutoPendingQueryDto = {}) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.autoPendingTransaction.findMany({
      where: { ledgerId, status: query.status ?? "pending" },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    });
  }

  async updatePending(
    ledgerId: string,
    pendingId: string,
    userId: string,
    input: UpdateAutoPendingDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.assertPending(ledgerId, pendingId);
    const account = this.mergeAccountPair(
      { accountId: existing.accountId, subAccountId: existing.subAccountId },
      { accountId: input.accountId, subAccountId: input.subAccountId },
    );
    const fromAccount = this.mergeAccountPair(
      { accountId: existing.fromAccountId, subAccountId: existing.fromSubAccountId },
      { accountId: input.fromAccountId, subAccountId: input.fromSubAccountId },
    );
    const toAccount = this.mergeAccountPair(
      { accountId: existing.toAccountId, subAccountId: existing.toSubAccountId },
      { accountId: input.toAccountId, subAccountId: input.toSubAccountId },
    );
    await this.assertAutoPayload(ledgerId, existing.type, {
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      subcategoryId:
        input.categoryId !== undefined && input.subcategoryId === undefined
          ? null
          : input.subcategoryId === undefined
            ? existing.subcategoryId
            : input.subcategoryId,
      accountId: account.accountId,
      subAccountId: account.subAccountId,
      fromAccountId: fromAccount.accountId,
      fromSubAccountId: fromAccount.subAccountId,
      toAccountId: toAccount.accountId,
      toSubAccountId: toAccount.subAccountId,
      personId: input.personId === undefined ? existing.personId : input.personId,
    });
    return this.prisma.client.autoPendingTransaction.update({
      where: { id: pendingId },
      data: {
        amountMicros: input.amountMicros === undefined ? undefined : BigInt(input.amountMicros),
        scheduledFor: input.scheduledFor ? parseDateOnly(input.scheduledFor) : undefined,
        categoryId: existing.type === "transfer" ? null : input.categoryId,
        subcategoryId:
          existing.type === "transfer"
            ? null
            : input.categoryId !== undefined && input.subcategoryId === undefined
              ? null
              : input.subcategoryId,
        accountId: existing.type === "transfer" ? null : input.accountId,
        subAccountId:
          existing.type === "transfer"
            ? null
            : input.accountId !== undefined && input.subAccountId === undefined
              ? null
              : input.subAccountId,
        fromAccountId: existing.type === "transfer" ? input.fromAccountId : null,
        fromSubAccountId:
          existing.type === "transfer"
            ? input.fromAccountId !== undefined && input.fromSubAccountId === undefined
              ? null
              : input.fromSubAccountId
            : null,
        toAccountId: existing.type === "transfer" ? input.toAccountId : null,
        toSubAccountId:
          existing.type === "transfer"
            ? input.toAccountId !== undefined && input.toSubAccountId === undefined
              ? null
              : input.toSubAccountId
            : null,
        personId: existing.type === "transfer" ? null : input.personId,
        note: input.note,
        updatedBy: userId,
      },
    });
  }

  async confirmPending(ledgerId: string, pendingId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.txs.run((tx) => this.confirmPendingInTransaction(tx, ledgerId, pendingId, userId));
  }

  async confirmPendingBatch(ledgerId: string, pendingIds: string[], userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    // All-or-nothing: a single failing pending rolls back the whole batch.
    return this.txs.run(async (tx) => {
      const transactions = [];
      for (const pendingId of pendingIds) {
        transactions.push(await this.confirmPendingInTransaction(tx, ledgerId, pendingId, userId));
      }
      return transactions;
    });
  }

  private async confirmPendingInTransaction(
    tx: PrismaTransactionClient,
    ledgerId: string,
    pendingId: string,
    userId: string,
  ) {
    const pending = await tx.autoPendingTransaction.findFirst({
      where: { id: pendingId, ledgerId, status: "pending" },
    });
    if (!pending) throw new AppError("AUTO_PENDING_NOT_FOUND", "待确认记录不存在", 404);
    const transaction = await this.transactions.createInsideExistingTransaction(
      tx,
      ledgerId,
      userId,
      this.pendingToTransaction(pending),
      { source: "auto", sourceId: pending.id, auditAction: "auto_pending.confirm" },
    );
    await tx.autoPendingTransaction.update({
      where: { id: pending.id },
      data: {
        status: "confirmed",
        confirmedTransactionId: transaction.id,
        confirmedBy: userId,
        confirmedAt: new Date(),
        updatedBy: userId,
      },
    });
    return transaction;
  }

  async deletePending(ledgerId: string, pendingId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPending(ledgerId, pendingId);
    await this.prisma.client.autoPendingTransaction.update({
      where: { id: pendingId },
      data: { status: "deleted", deletedBy: userId, deletedAt: new Date(), updatedBy: userId },
    });
  }

  async listTemplates(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.quickTemplate.findMany({
      where: { ledgerId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async createTemplate(ledgerId: string, userId: string, input: CreateQuickTemplateDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertCategory(ledgerId, input.type, input.categoryId, input.subcategoryId);
    return this.prisma.client.quickTemplate.create({
      data: this.templateData(ledgerId, userId, input),
    });
  }

  async updateTemplate(
    ledgerId: string,
    templateId: string,
    userId: string,
    input: UpdateQuickTemplateDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.assertTemplate(ledgerId, templateId);
    const type = input.type ?? existing.type;
    const categoryId = input.categoryId ?? existing.categoryId;
    const subcategoryId =
      input.subcategoryId === undefined
        ? (existing.subcategoryId ?? undefined)
        : input.subcategoryId;
    await this.assertCategory(ledgerId, type, categoryId, subcategoryId);
    if (input.accountId || input.subAccountId !== undefined) {
      await this.assertAccount(
        ledgerId,
        input.accountId ?? existing.accountId ?? "",
        input.subAccountId ?? existing.subAccountId ?? undefined,
      );
    }
    if (input.personId) await this.assertPerson(ledgerId, input.personId);
    return this.prisma.client.quickTemplate.update({
      where: { id: templateId },
      data: {
        type: input.type,
        name: input.name,
        amountMicros: input.amountMicros === undefined ? undefined : BigInt(input.amountMicros),
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId,
        accountId: input.accountId,
        subAccountId: input.subAccountId,
        personId: input.personId,
        note: input.note,
        directEnabled: input.directEnabled,
        sortOrder: input.sortOrder,
        updatedBy: userId,
      },
    });
  }

  async archiveTemplate(ledgerId: string, templateId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertTemplate(ledgerId, templateId);
    await this.prisma.client.quickTemplate.update({
      where: { id: templateId },
      data: { archivedAt: new Date(), updatedBy: userId },
    });
  }

  async prefillTemplate(ledgerId: string, templateId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const template = await this.assertTemplate(ledgerId, templateId);
    return this.templateToTransaction(template, todayKey());
  }

  async runTemplate(ledgerId: string, templateId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const template = await this.assertTemplate(ledgerId, templateId);
    if (!template.directEnabled)
      throw new AppError("QUICK_TEMPLATE_DIRECT_DISABLED", "模板未开启直接记账", 400);
    if (!template.amountMicros)
      throw new AppError("QUICK_TEMPLATE_AMOUNT_REQUIRED", "直接记账模板必须包含金额", 400);
    return this.transactions.create(
      ledgerId,
      userId,
      this.templateToTransaction(template, todayKey()),
      undefined,
      {
        source: "quick",
        sourceId: template.id,
        auditAction: "quick_template.run",
      },
    );
  }

  private pendingToTransaction(
    pending: Prisma.AutoPendingTransactionGetPayload<Record<string, never>>,
  ): CreateTransactionDto {
    if (pending.type === "transfer") {
      return {
        type: pending.type,
        grossAmountMicros: pending.amountMicros.toString(),
        occurredOn: dateKey(pending.scheduledFor),
        fromAccountId: pending.fromAccountId ?? undefined,
        fromSubAccountId: pending.fromSubAccountId ?? undefined,
        toAccountId: pending.toAccountId ?? undefined,
        toSubAccountId: pending.toSubAccountId ?? undefined,
        note: pending.note ?? undefined,
      };
    }
    return {
      type: pending.type,
      grossAmountMicros: pending.amountMicros.toString(),
      occurredOn: dateKey(pending.scheduledFor),
      categoryId: pending.categoryId ?? undefined,
      subcategoryId: pending.subcategoryId ?? undefined,
      accountId: pending.accountId ?? undefined,
      subAccountId: pending.subAccountId ?? undefined,
      personId: pending.personId ?? undefined,
      note: pending.note ?? undefined,
    };
  }

  private templateToTransaction(
    template: Prisma.QuickTemplateGetPayload<Record<string, never>>,
    occurredOn: string,
  ): CreateTransactionDto {
    return {
      type: template.type,
      grossAmountMicros: template.amountMicros?.toString() ?? "",
      occurredOn,
      categoryId: template.categoryId,
      subcategoryId: template.subcategoryId ?? undefined,
      accountId: template.accountId ?? undefined,
      subAccountId: template.subAccountId ?? undefined,
      personId: template.personId ?? undefined,
      note: template.note ?? undefined,
    };
  }

  private templateData(
    ledgerId: string,
    userId: string,
    input: CreateQuickTemplateDto,
  ): Prisma.QuickTemplateUncheckedCreateInput {
    return {
      ledgerId,
      type: input.type,
      name: input.name,
      amountMicros: input.amountMicros ? BigInt(input.amountMicros) : null,
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId ?? null,
      accountId: input.accountId ?? null,
      subAccountId: input.subAccountId ?? null,
      personId: input.personId ?? null,
      note: input.note ?? null,
      directEnabled: input.directEnabled ?? false,
      sortOrder: input.sortOrder ?? 0,
      createdBy: userId,
      updatedBy: userId,
    };
  }

  private async assertRule(ledgerId: string, ruleId: string) {
    const rule = await this.prisma.client.autoRule.findFirst({
      where: { id: ruleId, ledgerId, archivedAt: null },
    });
    if (!rule) throw new AppError("AUTO_RULE_NOT_FOUND", "自动记账规则不存在", 404);
    return rule;
  }

  private async assertPending(ledgerId: string, pendingId: string) {
    const pending = await this.prisma.client.autoPendingTransaction.findFirst({
      where: { id: pendingId, ledgerId, status: "pending" },
    });
    if (!pending) throw new AppError("AUTO_PENDING_NOT_FOUND", "待确认记录不存在", 404);
    return pending;
  }

  private async assertTemplate(ledgerId: string, templateId: string) {
    const template = await this.prisma.client.quickTemplate.findFirst({
      where: { id: templateId, ledgerId, archivedAt: null },
    });
    if (!template) throw new AppError("QUICK_TEMPLATE_NOT_FOUND", "快捷模板不存在", 404);
    return template;
  }

  private mergeAccountPair(existing: AccountPair, input: Partial<AccountPair>): AccountPair {
    const accountId = input.accountId === undefined ? existing.accountId : input.accountId;
    const subAccountId =
      input.accountId !== undefined && input.subAccountId === undefined
        ? null
        : input.subAccountId === undefined
          ? existing.subAccountId
          : input.subAccountId;
    return { accountId: accountId ?? null, subAccountId: subAccountId ?? null };
  }

  private async assertAutoPayload(ledgerId: string, type: string, payload: AutoPayload) {
    if (type === "transfer") {
      if (!payload.fromAccountId || !payload.toAccountId) {
        throw new AppError("TRANSFER_ACCOUNTS_REQUIRED", "转账必须选择转出和转入账户", 400);
      }
      await this.assertAccount(ledgerId, payload.fromAccountId, payload.fromSubAccountId ?? undefined);
      await this.assertAccount(ledgerId, payload.toAccountId, payload.toSubAccountId ?? undefined);
      if (
        payload.fromAccountId === payload.toAccountId &&
        (payload.fromSubAccountId ?? null) === (payload.toSubAccountId ?? null)
      ) {
        throw new AppError("TRANSFER_SAME_ACCOUNT", "转出和转入账户不能相同", 400);
      }
      return;
    }

    if (!payload.categoryId) throw new AppError("CATEGORY_REQUIRED", "请选择分类", 400);
    await this.assertCategory(ledgerId, type, payload.categoryId, payload.subcategoryId ?? undefined);
    if (payload.subAccountId && !payload.accountId) {
      throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    }
    if (payload.accountId) {
      await this.assertAccount(ledgerId, payload.accountId, payload.subAccountId ?? undefined);
    }
    if (payload.personId) await this.assertPerson(ledgerId, payload.personId);
  }

  private async assertCategory(
    ledgerId: string,
    type: string,
    categoryId: string,
    subcategoryId?: string,
  ) {
    const category = await this.prisma.client.category.findFirst({
      where: { id: categoryId, ledgerId, type, archivedAt: null },
    });
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在", 404);
    if (!subcategoryId) return;
    const subcategory = await this.prisma.client.subcategory.findFirst({
      where: { id: subcategoryId, ledgerId, categoryId, archivedAt: null },
    });
    if (!subcategory) throw new AppError("SUBCATEGORY_NOT_FOUND", "子分类不存在", 404);
  }

  private async assertAccount(ledgerId: string, accountId: string, subAccountId?: string) {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, ledgerId, archivedAt: null },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    if (!subAccountId) return;
    const subAccount = await this.prisma.client.subAccount.findFirst({
      where: { id: subAccountId, ledgerId, accountId, archivedAt: null },
    });
    if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
  }

  private async assertPerson(ledgerId: string, personId: string) {
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId, ledgerId, archivedAt: null },
    });
    if (!person) throw new AppError("PERSON_NOT_FOUND", "人员不存在", 404);
  }
}
