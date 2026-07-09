import { Injectable } from "@nestjs/common";
import { AppError, parseDateOnly, PrismaService } from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { FilesService } from "../files/files.service";
import { LedgersService } from "../ledgers/ledgers.service";
import { CreateInsuranceDto, UpdateInsuranceDto } from "./dto/insurance.dto";
import {
  CreateItemDto,
  CreateItemTypeDto,
  ScrapItemDto,
  UpdateItemDto,
  UpdateItemTypeDto,
} from "./dto/item.dto";

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
    private readonly files: FilesService,
  ) {}

  async listInsurances(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.insurance.findMany({
      where: { ledgerId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async getInsurance(ledgerId: string, insuranceId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const insurance = await this.assertInsurance(ledgerId, insuranceId);
    const [insuredPeople, links] = await Promise.all([
      this.prisma.client.insuranceInsuredPerson.findMany({ where: { insuranceId } }),
      this.linkedTransactions(ledgerId, "insurance", insuranceId),
    ]);
    return { ...insurance, insuredPeople, ...links };
  }

  async createInsurance(ledgerId: string, userId: string, input: CreateInsuranceDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.$transaction(async (tx) => {
      const insurance = await tx.insurance.create({
        data: this.insuranceData(ledgerId, userId, input),
      });
      await this.replaceInsuredPeople(tx, ledgerId, insurance.id, input.insuredPersonIds ?? []);
      return insurance;
    });
  }

  async updateInsurance(
    ledgerId: string,
    insuranceId: string,
    userId: string,
    input: UpdateInsuranceDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertInsurance(ledgerId, insuranceId);
    return this.prisma.client.$transaction(async (tx) => {
      const insurance = await tx.insurance.update({
        where: { id: insuranceId },
        data: this.insuranceUpdateData(userId, input),
      });
      if (input.insuredPersonIds)
        await this.replaceInsuredPeople(tx, ledgerId, insuranceId, input.insuredPersonIds);
      return insurance;
    });
  }

  async terminateInsurance(ledgerId: string, insuranceId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertInsurance(ledgerId, insuranceId);
    return this.prisma.client.insurance.update({
      where: { id: insuranceId },
      data: { terminatedAt: new Date(), updatedBy: userId },
    });
  }

  async resumeInsurance(ledgerId: string, insuranceId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertInsurance(ledgerId, insuranceId);
    return this.prisma.client.insurance.update({
      where: { id: insuranceId },
      data: { terminatedAt: null, updatedBy: userId },
    });
  }

  async deleteInsurance(ledgerId: string, insuranceId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertInsurance(ledgerId, insuranceId);
    await this.prisma.client.insurance.update({
      where: { id: insuranceId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.files.deleteAttachmentsForOwner(ledgerId, "insurance", insuranceId);
  }

  async listItemTypes(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.itemType.findMany({
      where: { ledgerId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async createItemType(ledgerId: string, userId: string, input: CreateItemTypeDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const count = await this.prisma.client.itemType.count({
      where: { ledgerId, archivedAt: null },
    });
    return this.prisma.client.itemType.create({
      data: {
        ledgerId,
        name: input.name,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? count,
      },
    });
  }

  async updateItemType(ledgerId: string, typeId: string, userId: string, input: UpdateItemTypeDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItemType(ledgerId, typeId);
    return this.prisma.client.itemType.update({
      where: { id: typeId },
      data: {
        name: input.name,
        icon: input.icon,
        sortOrder: input.sortOrder,
      },
    });
  }

  // 归档而非删除：已记录的物品仍通过 typeId 显示类型名，仅从选择/管理列表隐藏。
  async archiveItemType(ledgerId: string, typeId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItemType(ledgerId, typeId);
    await this.prisma.client.itemType.update({
      where: { id: typeId },
      data: { archivedAt: new Date() },
    });
  }

  async reorderItemTypes(ledgerId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.prisma.client.itemType.findMany({
      where: { ledgerId, archivedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((type) => type.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw new AppError("ITEM_TYPE_ORDER_MISMATCH", "物品类型顺序与当前类型不一致", 400);
    }
    await this.prisma.client.$transaction(
      ids.map((id, index) =>
        this.prisma.client.itemType.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
  }

  async listItems(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const items = await this.prisma.client.item.findMany({
      where: { ledgerId, deletedAt: null },
      orderBy: [{ typeId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (!items.length) return items;
    const links = await this.prisma.client.transactionLink.findMany({
      where: { ledgerId, linkedType: "item", linkKind: "consumable" },
    });
    const transactions = links.length
      ? await this.prisma.client.transaction.findMany({
          where: { id: { in: links.map((link) => link.transactionId) }, deletedAt: null },
        })
      : [];
    const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
    // 耗材合计：关联支出累加、关联收入（如转卖回款）抵减。
    const consumablesByItem = new Map<string, bigint>();
    for (const link of links) {
      const tx = transactionById.get(link.transactionId);
      if (!tx) continue;
      const delta =
        tx.type === "expense"
          ? tx.effectiveAmountMicros
          : tx.type === "income"
            ? -tx.effectiveAmountMicros
            : 0n;
      consumablesByItem.set(link.linkedId, (consumablesByItem.get(link.linkedId) ?? 0n) + delta);
    }
    return items.map((item) => ({
      ...item,
      consumablesMicros: (consumablesByItem.get(item.id) ?? 0n).toString(),
    }));
  }

  async getItem(ledgerId: string, itemId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const item = await this.assertItem(ledgerId, itemId);
    const links = await this.linkedTransactions(ledgerId, "item", itemId);
    const age = this.itemUsage(item);
    return { ...item, ...links, ...age };
  }

  async createItem(ledgerId: string, userId: string, input: CreateItemDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    if (input.typeId) await this.assertItemType(ledgerId, input.typeId);
    const sortOrder = await this.prisma.client.item.count({
      where: { ledgerId, deletedAt: null, typeId: input.typeId ?? null },
    });
    return this.prisma.client.item.create({
      data: this.itemData(ledgerId, userId, input, sortOrder),
    });
  }

  async updateItem(ledgerId: string, itemId: string, userId: string, input: UpdateItemDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItem(ledgerId, itemId);
    if (input.typeId) await this.assertItemType(ledgerId, input.typeId);
    return this.prisma.client.item.update({
      where: { id: itemId },
      data: this.itemUpdateData(userId, input),
    });
  }

  async reorderItems(ledgerId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    const items = await this.prisma.client.item.findMany({
      where: { ledgerId, id: { in: ids }, deletedAt: null, scrappedAt: null },
      select: { id: true, typeId: true },
    });
    const existingIds = new Set(items.map((item) => item.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw new AppError("ITEM_ORDER_MISMATCH", "物品顺序与当前物品不一致", 400);
    }
    const [first] = items;
    const typeId = first?.typeId ?? null;
    if (items.some((item) => item.typeId !== typeId)) {
      throw new AppError("ITEM_ORDER_CROSS_TYPE", "只能在同一物品类型内排序", 400);
    }
    const groupItems = await this.prisma.client.item.findMany({
      where: { ledgerId, deletedAt: null, scrappedAt: null, typeId },
      select: { id: true },
    });
    const groupIds = new Set(groupItems.map((item) => item.id));
    if (ids.length !== groupIds.size || ids.some((id) => !groupIds.has(id))) {
      throw new AppError("ITEM_ORDER_MISMATCH", "物品顺序与当前物品不一致", 400);
    }
    await this.prisma.client.$transaction(
      ids.map((id, index) =>
        this.prisma.client.item.update({
          where: { id },
          data: { sortOrder: index, updatedBy: userId },
        }),
      ),
    );
  }

  async scrapItem(ledgerId: string, itemId: string, userId: string, input: ScrapItemDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItem(ledgerId, itemId);
    return this.prisma.client.item.update({
      where: { id: itemId },
      data: {
        scrappedAt: new Date(),
        scrapDate: input.scrapDate ? parseDateOnly(input.scrapDate) : new Date(),
        sellPriceMicros: input.sellPriceMicros ? BigInt(input.sellPriceMicros) : null,
        updatedBy: userId,
      },
    });
  }

  async restoreItem(ledgerId: string, itemId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItem(ledgerId, itemId);
    return this.prisma.client.item.update({
      where: { id: itemId },
      data: { scrappedAt: null, scrapDate: null, sellPriceMicros: null, updatedBy: userId },
    });
  }

  async deleteItem(ledgerId: string, itemId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertItem(ledgerId, itemId);
    await this.prisma.client.item.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.files.deleteAttachmentsForOwner(ledgerId, "item", itemId);
  }

  async linkTransaction(
    ledgerId: string,
    linkedType: "insurance" | "item",
    linkedId: string,
    transactionId: string,
    userId: string,
    linkKind?: string,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    if (linkedType === "insurance") await this.assertInsurance(ledgerId, linkedId);
    if (linkedType === "item") await this.assertItem(ledgerId, linkedId);
    const transaction = await this.prisma.client.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
    });
    if (!transaction) throw new AppError("TRANSACTION_NOT_FOUND", "交易不存在", 404);
    const normalizedKind = linkedType === "item" ? (linkKind ?? "consumable") : "related";
    return this.prisma.client.transactionLink.upsert({
      where: { transactionId_linkedType_linkedId: { transactionId, linkedType, linkedId } },
      create: { ledgerId, transactionId, linkedType, linkedId, linkKind: normalizedKind },
      update: { linkKind: normalizedKind },
    });
  }

  private insuranceData(
    ledgerId: string,
    userId: string,
    input: CreateInsuranceDto,
  ): Prisma.InsuranceUncheckedCreateInput {
    return {
      ledgerId,
      type: input.type,
      name: input.name,
      insurer: input.insurer,
      method: input.method,
      paymentMethod: input.paymentMethod,
      policyNo: input.policyNo,
      coverageMicros: input.coverageMicros ? BigInt(input.coverageMicros) : null,
      premiumMicros: input.premiumMicros ? BigInt(input.premiumMicros) : null,
      premiumFreq: input.premiumFreq,
      periods: input.periods,
      renewal: input.renewal,
      coverageDesc: input.coverageDesc,
      startDate: input.startDate ? parseDateOnly(input.startDate) : null,
      endDate: input.endDate ? parseDateOnly(input.endDate) : null,
      note: input.note,
      createdBy: userId,
      updatedBy: userId,
    };
  }

  private insuranceUpdateData(
    userId: string,
    input: UpdateInsuranceDto,
  ): Prisma.InsuranceUncheckedUpdateInput {
    return {
      type: input.type,
      name: input.name,
      insurer: input.insurer,
      method: input.method,
      paymentMethod: input.paymentMethod,
      policyNo: input.policyNo,
      coverageMicros: input.coverageMicros === undefined ? undefined : BigInt(input.coverageMicros),
      premiumMicros: input.premiumMicros === undefined ? undefined : BigInt(input.premiumMicros),
      premiumFreq: input.premiumFreq,
      periods: input.periods,
      renewal: input.renewal,
      coverageDesc: input.coverageDesc,
      startDate: input.startDate === undefined ? undefined : parseDateOnly(input.startDate),
      endDate: input.endDate === undefined ? undefined : parseDateOnly(input.endDate),
      note: input.note,
      updatedBy: userId,
    };
  }

  private itemData(
    ledgerId: string,
    userId: string,
    input: CreateItemDto,
    sortOrder: number,
  ): Prisma.ItemUncheckedCreateInput {
    return {
      ledgerId,
      name: input.name,
      typeId: input.typeId ?? null,
      purchasePriceMicros: input.purchasePriceMicros ? BigInt(input.purchasePriceMicros) : null,
      purchaseDate: input.purchaseDate ? parseDateOnly(input.purchaseDate) : null,
      expectedYears: input.expectedYears ? new Prisma.Decimal(input.expectedYears) : null,
      note: input.note,
      sortOrder,
      createdBy: userId,
      updatedBy: userId,
    };
  }

  private itemUpdateData(userId: string, input: UpdateItemDto): Prisma.ItemUncheckedUpdateInput {
    return {
      name: input.name,
      typeId: input.typeId,
      purchasePriceMicros:
        input.purchasePriceMicros === undefined ? undefined : BigInt(input.purchasePriceMicros),
      purchaseDate:
        input.purchaseDate === undefined ? undefined : parseDateOnly(input.purchaseDate),
      expectedYears:
        input.expectedYears === undefined ? undefined : new Prisma.Decimal(input.expectedYears),
      note: input.note,
      updatedBy: userId,
    };
  }

  private async linkedTransactions(ledgerId: string, linkedType: string, linkedId: string) {
    const links = await this.prisma.client.transactionLink.findMany({
      where: { ledgerId, linkedType, linkedId },
    });
    const consumableTransactionIds =
      linkedType === "item"
        ? new Set(
            links
              .filter((link) => link.linkKind === "consumable")
              .map((link) => link.transactionId),
          )
        : null;
    const transactions = links.length
      ? await this.prisma.client.transaction.findMany({
          where: { id: { in: links.map((link) => link.transactionId) }, deletedAt: null },
          orderBy: { occurredOn: "desc" },
        })
      : [];
    const totalExpenseMicros = transactions.reduce((sum, tx) => {
      if (consumableTransactionIds && !consumableTransactionIds.has(tx.id)) return sum;
      return sum + (tx.type === "expense" ? tx.effectiveAmountMicros : 0n);
    }, 0n);
    return {
      transactionLinks: links,
      linkedTransactions: transactions,
      totalExpenseMicros: totalExpenseMicros.toString(),
    };
  }

  private itemUsage(item: Prisma.ItemGetPayload<Record<string, never>>) {
    if (!item.purchaseDate || !item.expectedYears) return { usagePercent: null };
    const totalMs = Number(item.expectedYears) * 365 * 24 * 60 * 60 * 1000;
    const usedMs = Date.now() - item.purchaseDate.getTime();
    return {
      usagePercent: Math.max(0, Math.min(100, Math.round((usedMs / totalMs) * 10000) / 100)),
    };
  }

  private async replaceInsuredPeople(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    insuranceId: string,
    personIds: string[],
  ) {
    if (personIds.length) {
      const count = await tx.person.count({
        where: { ledgerId, id: { in: personIds }, archivedAt: null },
      });
      if (count !== personIds.length) throw new AppError("PERSON_NOT_FOUND", "人员不存在", 404);
    }
    await tx.insuranceInsuredPerson.deleteMany({ where: { insuranceId } });
    await tx.insuranceInsuredPerson.createMany({
      data: personIds.map((personId) => ({ insuranceId, personId })),
    });
  }

  private async assertInsurance(ledgerId: string, insuranceId: string) {
    const insurance = await this.prisma.client.insurance.findFirst({
      where: { id: insuranceId, ledgerId, deletedAt: null },
    });
    if (!insurance) throw new AppError("INSURANCE_NOT_FOUND", "保险不存在", 404);
    return insurance;
  }

  private async assertItem(ledgerId: string, itemId: string) {
    const item = await this.prisma.client.item.findFirst({
      where: { id: itemId, ledgerId, deletedAt: null },
    });
    if (!item) throw new AppError("ITEM_NOT_FOUND", "物品不存在", 404);
    return item;
  }

  private async assertItemType(ledgerId: string, typeId: string) {
    const type = await this.prisma.client.itemType.findFirst({ where: { id: typeId, ledgerId } });
    if (!type) throw new AppError("ITEM_TYPE_NOT_FOUND", "物品类型不存在", 404);
  }
}
