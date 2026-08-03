import type { AttachmentItem, RecoverablePayableItem } from "@/components/business";
import type {
  Account,
  AttachmentRecord,
  Category,
  TransactionInput,
  TransactionRelationInput,
  TransactionType,
} from "@/lib/api";
import {
  relationKindFor,
  resolveAccountSelection,
} from "@/lib/data/options";
import { createClientId } from "@/lib/id/client-id";
import { microsToInput, parseMoneyToMicros } from "@/lib/money";

export type RelationBucket = "primary" | "linked";

export type PendingAttachment = AttachmentItem & {
  file: File;
};

// 待确认确认接口的 PATCH body（对应后端 UpdateAutoPendingDto）。
export type PendingPatchBody = {
  amountMicros: string;
  scheduledFor: string;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  personId: string | null;
  note: string;
};

/** 纯函数返回结果：成功携带值，失败携带面向用户的错误信息（由调用方转 toast）。 */
export type BuildResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveCategory(
  categories: Category[] | undefined,
  selectedId: string | null,
): { categoryId?: string; subcategoryId?: string } {
  if (!selectedId || !categories) return {};
  for (const category of categories) {
    if (category.id === selectedId) return { categoryId: category.id };
    const sub = category.subcategories.find((item) => item.id === selectedId);
    if (sub) return { categoryId: category.id, subcategoryId: sub.id };
  }
  return {};
}

export function relationAccountKind(
  type: TransactionType,
  bucket: RelationBucket,
): "receivable" | "payable" {
  if (type === "income") return bucket === "primary" ? "payable" : "receivable";
  return bucket === "primary" ? "receivable" : "payable";
}

export function splitInitialRelations(
  relations: Array<{ id?: string; accountId: string; relationKind: string; amountMicros: string }>,
  decimalPlaces: number,
): Record<RelationBucket, RecoverablePayableItem[]> {
  const buckets: Record<RelationBucket, RecoverablePayableItem[]> = { primary: [], linked: [] };
  for (const relation of relations) {
    const bucket =
      relation.relationKind === "receivable_from_expense" ||
      relation.relationKind === "payable_from_income"
        ? "primary"
        : "linked";
    buckets[bucket].push({
      id: relation.id ?? createClientId("relation"),
      accountId: relation.accountId,
      amount: microsToInput(relation.amountMicros, { decimalPlaces, omitZeroFraction: false }),
    });
  }
  return buckets;
}

export function formatDateLabel(value: string): string {
  const today = todayKey();
  if (value === today) return "今天";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value.replaceAll("-", ".");
  if (year === new Date().getFullYear()) return `${month}.${day}`;
  return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

/** 把服务端附件记录映射成选择器展示用的项（无本地 File，靠 onOpen 拉取内容）。 */
export function recordToAttachmentItem(record: AttachmentRecord): AttachmentItem {
  return {
    contentType: record.file?.mime,
    id: record.id,
    name: record.file?.originalName ?? `附件 ${record.id.slice(0, 6)}`,
    sizeBytes: record.file?.sizeBytes ? Number(record.file.sizeBytes) : undefined,
  };
}

type RelationParams = {
  type: TransactionType;
  bucket: RelationBucket;
  enabled: boolean;
  items: RecoverablePayableItem[];
  accounts: Account[];
  decimalPlaces: number;
};

export function buildRelations(params: RelationParams): BuildResult<TransactionRelationInput[]> {
  const { type, bucket, enabled, items, accounts, decimalPlaces } = params;
  if (!enabled) return { ok: true, value: [] };
  const relations: TransactionRelationInput[] = [];
  for (const item of items) {
    if (!item.accountId) continue;
    const parsed = parseMoneyToMicros(item.amount, { decimalPlaces });
    if (!parsed.ok || !parsed.amountMicros || BigInt(parsed.amountMicros) <= 0n) {
      return { ok: false, message: "关联项目金额无效" };
    }
    const relationAccount = accounts.find((account) => account.id === item.accountId);
    const expectedKind = relationAccountKind(type, bucket);
    if (!relationAccount || relationAccount.type !== expectedKind) {
      return { ok: false, message: "关联项目类型不正确" };
    }
    const relationKind = relationKindFor(type, relationAccount.type);
    if (!relationKind) {
      return { ok: false, message: "当前交易类型不支持关联" };
    }
    relations.push({ accountId: item.accountId, relationKind, amountMicros: parsed.amountMicros });
  }
  return { ok: true, value: relations };
}

export type PayloadParams = {
  type: TransactionType;
  amount: string;
  decimalPlaces: number;
  occurredOn: string;
  accounts: Account[];
  categories: Category[];
  categoryId: string | null;
  fromSel: string | null;
  toSel: string | null;
  accountSel: string | null;
  accountEnabled: boolean;
  personEnabled: boolean;
  personId: string | null;
  acctRequired: boolean;
  personRequired: boolean;
  note: string;
  primaryRelationsEnabled: boolean;
  primaryRelationItems: RecoverablePayableItem[];
  linkedRelationsEnabled: boolean;
  linkedRelationItems: RecoverablePayableItem[];
  insuranceEnabled: boolean;
  selectedInsuranceId: string | null;
  itemEnabled: boolean;
  selectedItemId: string | null;
  selectedItemLinkKind: "consumable" | "purchase";
  subscriptionEnabled: boolean;
  selectedSubscriptionId: string | null;
};

export function buildPayload(params: PayloadParams): BuildResult<TransactionInput> {
  const {
    type,
    amount,
    decimalPlaces,
    occurredOn,
    accounts,
    categories,
    categoryId,
    fromSel,
    toSel,
    accountSel,
    accountEnabled,
    personEnabled,
    personId,
    acctRequired,
    personRequired,
    note,
    primaryRelationsEnabled,
    primaryRelationItems,
    linkedRelationsEnabled,
    linkedRelationItems,
    insuranceEnabled,
    selectedInsuranceId,
    itemEnabled,
    selectedItemId,
    selectedItemLinkKind,
    subscriptionEnabled,
    selectedSubscriptionId,
  } = params;

  const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
  if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
    return { ok: false, message: "请输入有效金额" };
  }

  if (type === "transfer") {
    const from = resolveAccountSelection(accounts, fromSel);
    const to = resolveAccountSelection(accounts, toSel);
    if (!from.accountId || !to.accountId) {
      return { ok: false, message: "转账需要选择转出和转入账户" };
    }
    if (from.accountId === to.accountId && (from.subAccountId ?? null) === (to.subAccountId ?? null)) {
      return { ok: false, message: "转出和转入不能是同一账户" };
    }
    if (personRequired && !personId) {
      return { ok: false, message: "当前账本要求选择人员" };
    }
    return {
      ok: true,
      value: {
        type,
        grossAmountMicros: parsedAmount.amountMicros,
        occurredOn,
        fromAccountId: from.accountId,
        fromSubAccountId: from.subAccountId,
        toAccountId: to.accountId,
        toSubAccountId: to.subAccountId,
        personId: personEnabled ? (personId ?? undefined) : undefined,
        insuranceId: null,
        itemId: null,
        subscriptionId: null,
        note: note.trim() || undefined,
      },
    };
  }

  const account = accountEnabled ? resolveAccountSelection(accounts, accountSel) : {};
  if (acctRequired && !account.accountId) {
    return { ok: false, message: "当前账本要求绑定账户" };
  }
  if (personRequired && !personId) {
    return { ok: false, message: "当前账本要求选择人员" };
  }

  const { categoryId: catId, subcategoryId } = resolveCategory(categories, categoryId);
  if (!catId) {
    return { ok: false, message: "请选择分类" };
  }

  const primary = buildRelations({
    type,
    bucket: "primary",
    enabled: primaryRelationsEnabled,
    items: primaryRelationItems,
    accounts,
    decimalPlaces,
  });
  if (!primary.ok) return primary;
  const linked = buildRelations({
    type,
    bucket: "linked",
    enabled: linkedRelationsEnabled,
    items: linkedRelationItems,
    accounts,
    decimalPlaces,
  });
  if (!linked.ok) return linked;

  const relations = [...primary.value, ...linked.value];
  return {
    ok: true,
    value: {
      type,
      grossAmountMicros: parsedAmount.amountMicros,
      occurredOn,
      categoryId: catId,
      subcategoryId,
      personId: personEnabled ? (personId ?? undefined) : undefined,
      accountId: account.accountId,
      subAccountId: account.subAccountId,
      note: note.trim() || undefined,
      insuranceId: insuranceEnabled ? selectedInsuranceId : null,
      itemId: itemEnabled ? selectedItemId : null,
      itemLinkKind: itemEnabled && selectedItemId ? selectedItemLinkKind : undefined,
      subscriptionId: subscriptionEnabled ? selectedSubscriptionId : null,
      relations: relations.length > 0 ? relations : undefined,
    },
  };
}

export type PendingPatchParams = Pick<
  PayloadParams,
  | "type"
  | "amount"
  | "decimalPlaces"
  | "occurredOn"
  | "accounts"
  | "categories"
  | "categoryId"
  | "fromSel"
  | "toSel"
  | "accountSel"
  | "accountEnabled"
  | "personEnabled"
  | "personId"
  | "acctRequired"
  | "personRequired"
  | "note"
>;

export function buildPendingPatch(params: PendingPatchParams): BuildResult<PendingPatchBody> {
  const {
    type,
    amount,
    decimalPlaces,
    occurredOn,
    accounts,
    categories,
    categoryId,
    fromSel,
    toSel,
    accountSel,
    accountEnabled,
    personEnabled,
    personId,
    acctRequired,
    personRequired,
    note,
  } = params;

  const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
  if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
    return { ok: false, message: "请输入有效金额" };
  }
  const base = {
    amountMicros: parsedAmount.amountMicros,
    scheduledFor: occurredOn,
    note: note.trim(),
  };
  if (type === "transfer") {
    const from = resolveAccountSelection(accounts, fromSel);
    const to = resolveAccountSelection(accounts, toSel);
    if (!from.accountId || !to.accountId) {
      return { ok: false, message: "转账需要选择转出和转入账户" };
    }
    if (from.accountId === to.accountId && (from.subAccountId ?? null) === (to.subAccountId ?? null)) {
      return { ok: false, message: "转出和转入不能是同一账户" };
    }
    return {
      ok: true,
      value: {
        ...base,
        categoryId: null,
        subcategoryId: null,
        accountId: null,
        subAccountId: null,
        fromAccountId: from.accountId,
        fromSubAccountId: from.subAccountId ?? null,
        toAccountId: to.accountId,
        toSubAccountId: to.subAccountId ?? null,
        personId: personEnabled ? (personId ?? null) : null,
      },
    };
  }
  const { categoryId: catId, subcategoryId } = resolveCategory(categories, categoryId);
  if (!catId) {
    return { ok: false, message: "请选择分类" };
  }
  const account = accountEnabled ? resolveAccountSelection(accounts, accountSel) : {};
  if (acctRequired && !account.accountId) {
    return { ok: false, message: "当前账本要求绑定账户" };
  }
  if (personRequired && !personId) {
    return { ok: false, message: "当前账本要求选择人员" };
  }
  return {
    ok: true,
    value: {
      ...base,
      categoryId: catId,
      subcategoryId: subcategoryId ?? null,
      accountId: account.accountId ?? null,
      subAccountId: account.subAccountId ?? null,
      fromAccountId: null,
      fromSubAccountId: null,
      toAccountId: null,
      toSubAccountId: null,
      personId: personEnabled ? (personId ?? null) : null,
    },
  };
}

export type ValidationParams = Pick<
  PayloadParams,
  | "type"
  | "amount"
  | "decimalPlaces"
  | "accounts"
  | "categories"
  | "categoryId"
  | "fromSel"
  | "toSel"
  | "accountSel"
  | "acctRequired"
  | "personRequired"
  | "personId"
>;

export function computeValidationMessage(params: ValidationParams): string | null {
  const {
    type,
    amount,
    decimalPlaces,
    accounts,
    categories,
    categoryId,
    fromSel,
    toSel,
    accountSel,
    acctRequired,
    personRequired,
    personId,
  } = params;
  const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
  if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
    return "请输入有效金额";
  }
  if (type === "transfer") {
    const from = resolveAccountSelection(accounts, fromSel);
    const to = resolveAccountSelection(accounts, toSel);
    if (!from.accountId || !to.accountId) return "请选择转出和转入账户";
    if (from.accountId === to.accountId && (from.subAccountId ?? null) === (to.subAccountId ?? null)) {
      return "转出和转入不能是同一账户";
    }
    if (personRequired && !personId) return "当前账本要求选择人员";
    return null;
  }
  if (!resolveCategory(categories, categoryId).categoryId) return "请选择分类";
  if (acctRequired && !resolveAccountSelection(accounts, accountSel).accountId) {
    return "当前账本要求绑定账户";
  }
  if (personRequired && !personId) return "当前账本要求选择人员";
  return null;
}
