"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AccountSelectRow,
  AmountInput,
  AssetLinkCard,
  AttachmentPicker,
  CategorySelectRow,
  DateWheelPicker,
  FieldCard,
  LoadingState,
  PersonSelectField,
  RecoverablePayableEditor,
  ToggleCard,
  type AttachmentItem,
  type RecoverablePayableItem,
} from "@/components/business";
import { Input, Tabs } from "@/components/ui";
import {
  apiRequest,
  type AttachmentRecord,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  uploadAttachmentFile,
  type AutoPendingTransaction,
  type TransactionDetail,
  type TransactionInput,
  type TransactionRelationInput,
  type TransactionType,
} from "@/lib/api";
import {
  accountSelectionId,
  categoryOptions,
  moneyAccountOptions,
  personOptions,
  relationAccountOptions,
  relationKindFor,
  resolveAccountSelection,
} from "@/lib/data/options";
import { createClientId } from "@/lib/id/client-id";
import {
  useAccounts,
  useAttachments,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useRecordSetting,
} from "@/lib/data/records";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { ItemEditorSheet } from "../../more/items/_components/ItemEditorSheet";

const DEFAULT_FIELD_ORDER = ["type", "amount", "category", "account", "date", "person", "note"];

const TYPE_TAB_ITEMS: Array<{ label: string; value: TransactionType }> = [
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
  { label: "转账", value: "transfer" },
];

// 待确认确认接口的 PATCH body（对应后端 UpdateAutoPendingDto）。
type PendingPatchBody = {
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

type RelationBucket = "primary" | "linked";

type PendingAttachment = AttachmentItem & {
  file: File;
};

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function microsToInput(micros: string, decimalPlaces: number): string {
  const negative = micros.startsWith("-");
  const digits = (negative ? micros.slice(1) : micros).padStart(7, "0");
  const intPart = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(-6).slice(0, decimalPlaces);
  const body = decimalPlaces > 0 ? `${intPart}.${frac}` : intPart;
  return (negative ? "-" : "") + body;
}

function resolveCategory(
  categories: ReturnType<typeof useCategories>["data"],
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

function relationAccountKind(
  type: TransactionType,
  bucket: RelationBucket,
): "receivable" | "payable" {
  if (type === "income") return bucket === "primary" ? "payable" : "receivable";
  return bucket === "primary" ? "receivable" : "payable";
}

function splitInitialRelations(
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
      amount: microsToInput(relation.amountMicros, decimalPlaces),
    });
  }
  return buckets;
}

function formatDateLabel(value: string): string {
  const today = todayKey();
  if (value === today) return "今天";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value.replaceAll("-", ".");
  if (year === new Date().getFullYear()) return `${month}.${day}`;
  return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

function orderedFieldsForType(order: string[], type: TransactionType): string[] {
  const fields = order.filter((field) => field !== "type" && field !== "amount");
  if (type !== "transfer") return fields;

  const withoutAccount = fields.filter((field) => field !== "account");
  const dateIndex = withoutAccount.indexOf("date");
  if (dateIndex === -1) return [...withoutAccount, "account"];
  return [
    ...withoutAccount.slice(0, dateIndex + 1),
    "account",
    ...withoutAccount.slice(dateIndex + 1),
  ];
}

async function uploadAttachment(ledgerId: string, transactionId: string, item: PendingAttachment) {
  await uploadAttachmentFile(ledgerId, "transaction", transactionId, item.file);
}

/** 把服务端附件记录映射成选择器展示用的项（无本地 File，靠 onOpen 拉取内容）。 */
function recordToAttachmentItem(record: AttachmentRecord): AttachmentItem {
  return {
    contentType: record.file?.mime,
    id: record.id,
    name: record.file?.originalName ?? `附件 ${record.id.slice(0, 6)}`,
    sizeBytes: record.file?.sizeBytes ? Number(record.file.sizeBytes) : undefined,
  };
}

export type TransactionSeed = {
  type?: TransactionType;
  grossAmountMicros?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  personId?: string | null;
  accountId?: string | null;
  subAccountId?: string | null;
  fromAccountId?: string | null;
  fromSubAccountId?: string | null;
  toAccountId?: string | null;
  toSubAccountId?: string | null;
  note?: string | null;
  relations?: Array<{ accountId: string; relationKind: string; amountMicros: string }> | null;
  insuranceId?: string | null;
  itemId?: string | null;
};

type TransactionFormProps = {
  formId?: string;
  ledgerId: string;
  initial?: TransactionDetail;
  onCanSubmitChange?: (canSubmit: boolean) => void;
  onSubmitBlocked?: (submitBlocked: () => void) => void;
  onPendingChange?: (pending: boolean) => void;
  /** 待确认模式：预填这条待确认，提交时保存修改并直接确认入账。 */
  pending?: AutoPendingTransaction;
  seed?: TransactionSeed;
};

export function TransactionForm({
  formId,
  initial,
  ledgerId,
  onCanSubmitChange,
  onPendingChange,
  onSubmitBlocked,
  pending,
  seed,
}: TransactionFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const isEdit = Boolean(initial);
  // 待确认模式下不涉及关联/附件/资产（后端待确认更新接口不支持），提交=保存+确认。
  const isPendingMode = Boolean(pending);

  const settingQuery = useRecordSetting(ledgerId);
  const categoriesQuery = useCategories(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);

  const setting = settingQuery.data;
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const decimalPlaces = useDecimalPlaces();
  const idempotencyKey = useRef(createClientId("transaction"));

  const seedAmountMicros =
    initial?.grossAmountMicros ?? pending?.amountMicros ?? seed?.grossAmountMicros ?? null;
  const seedAccountSelection = accountSelectionId(
    initial?.accountId ?? pending?.accountId ?? seed?.accountId,
    initial?.subAccountId ?? pending?.subAccountId ?? seed?.subAccountId,
  );
  const initialBuckets = useMemo(
    () => splitInitialRelations(initial?.relations ?? seed?.relations ?? [], decimalPlaces),
    [decimalPlaces, initial, seed?.relations],
  );

  const [type, setType] = useState<TransactionType>(
    initial?.type ?? pending?.type ?? seed?.type ?? "expense",
  );
  const [amount, setAmount] = useState(() =>
    seedAmountMicros ? microsToInput(seedAmountMicros, decimalPlaces) : "",
  );
  const [occurredOn, setOccurredOn] = useState(
    initial?.occurredOn?.slice(0, 10) ?? pending?.scheduledFor?.slice(0, 10) ?? todayKey(),
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.subcategoryId ??
      initial?.categoryId ??
      pending?.subcategoryId ??
      pending?.categoryId ??
      seed?.subcategoryId ??
      seed?.categoryId ??
      null,
  );
  const [personId, setPersonId] = useState<string | null>(
    initial?.personId ?? pending?.personId ?? seed?.personId ?? null,
  );
  const [accountSel, setAccountSel] = useState<string | null>(seedAccountSelection);
  const [fromSel, setFromSel] = useState<string | null>(
    accountSelectionId(
      initial?.fromAccountId ?? pending?.fromAccountId ?? seed?.fromAccountId,
      initial?.fromSubAccountId ?? pending?.fromSubAccountId ?? seed?.fromSubAccountId,
    ),
  );
  const [toSel, setToSel] = useState<string | null>(
    accountSelectionId(
      initial?.toAccountId ?? pending?.toAccountId ?? seed?.toAccountId,
      initial?.toSubAccountId ?? pending?.toSubAccountId ?? seed?.toSubAccountId,
    ),
  );
  const [note, setNote] = useState(initial?.note ?? pending?.note ?? seed?.note ?? "");
  const [accountEnabled, setAccountEnabled] = useState(Boolean(seedAccountSelection));
  const [personEnabled, setPersonEnabled] = useState(
    Boolean(initial?.personId ?? pending?.personId ?? seed?.personId),
  );
  const [primaryRelationsEnabled, setPrimaryRelationsEnabled] = useState(
    initialBuckets.primary.length > 0,
  );
  const [linkedRelationsEnabled, setLinkedRelationsEnabled] = useState(
    initialBuckets.linked.length > 0,
  );
  const [primaryRelationItems, setPrimaryRelationItems] = useState<RecoverablePayableItem[]>(
    initialBuckets.primary,
  );
  const [linkedRelationItems, setLinkedRelationItems] = useState<RecoverablePayableItem[]>(
    initialBuckets.linked,
  );
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  // 编辑模式回显已有附件：既有附件（无本地 File）单独存一份，删除时记下 id 到保存时再删。
  const [existingAttachments, setExistingAttachments] = useState<AttachmentItem[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const attachmentsHydrated = useRef(false);
  const existingAttachmentsQuery = useAttachments(
    ledgerId,
    "transaction",
    isEdit && !isPendingMode && initial ? initial.id : null,
  );
  // 编辑模式下，回显已有的保险/物品关联（后端关联为 upsert 幂等，重新保存不会重复）。
  const initialInsuranceLink = initial?.links?.find((link) => link.linkedType === "insurance");
  const initialItemLink = initial?.links?.find((link) => link.linkedType === "item");
  const initialInsuranceId = initialInsuranceLink?.linkedId ?? seed?.insuranceId ?? null;
  const initialItemId = initialItemLink?.linkedId ?? seed?.itemId ?? null;
  const [insuranceEnabled, setInsuranceEnabled] = useState(Boolean(initialInsuranceId));
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(initialInsuranceId);
  const [itemEnabled, setItemEnabled] = useState(Boolean(initialItemId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId);
  const [selectedItemLinkKind, setSelectedItemLinkKind] = useState<"consumable" | "purchase">(
    initialItemLink?.linkKind === "purchase" ? "purchase" : "consumable",
  );

  const catOptions = useMemo(
    () => categoryOptions(categories, type === "income" ? "income" : "expense"),
    [categories, type],
  );
  const acctOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const peopleOpts = useMemo(() => personOptions(peopleQuery.data ?? []), [peopleQuery.data]);
  const primaryRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "primary")),
    [accounts, type],
  );
  const linkedRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "linked")),
    [accounts, type],
  );
  const insuranceOptions = useMemo(
    () =>
      (insurancesQuery.data ?? []).map((insurance) => ({
        id: insurance.id,
        icon: "保",
        name: insurance.name,
      })),
    [insurancesQuery.data],
  );
  const itemOptions = useMemo(
    () =>
      (itemsQuery.data ?? []).map((item) => ({
        id: item.id,
        icon: "物",
        name: item.name,
      })),
    [itemsQuery.data],
  );

  const visibleFields = setting?.visibleFields ?? {};
  const order = setting?.fieldOrder?.length ? setting.fieldOrder : DEFAULT_FIELD_ORDER;
  const acctRequired = setting?.acctRequired ?? false;
  const personRequired = setting?.personRequired ?? false;
  const showAccountCard = type !== "transfer" && visibleFields.account !== false;
  const showPersonCard = visibleFields.person !== false;
  const showNoteCard = visibleFields.note !== false;
  const showAttachmentCard = type !== "transfer" && visibleFields.attachments !== false;
  const validationMessage = useMemo(() => {
    const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
    if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
      return "请输入有效金额";
    }
    if (type === "transfer") {
      const from = resolveAccountSelection(accounts, fromSel);
      const to = resolveAccountSelection(accounts, toSel);
      if (!from.accountId || !to.accountId) return "请选择转出和转入账户";
      if (
        from.accountId === to.accountId &&
        (from.subAccountId ?? null) === (to.subAccountId ?? null)
      ) {
        return "转出和转入不能是同一账户";
      }
      if (personRequired && !personId) {
        return "当前账本要求选择人员";
      }
      return null;
    }
    if (!resolveCategory(categories, categoryId).categoryId) {
      return "请选择分类";
    }
    if (acctRequired && !resolveAccountSelection(accounts, accountSel).accountId) {
      return "当前账本要求绑定账户";
    }
    if (personRequired && !personId) {
      return "当前账本要求选择人员";
    }
    return null;
  }, [
    accountSel,
    accounts,
    acctRequired,
    amount,
    categories,
    categoryId,
    decimalPlaces,
    fromSel,
    personId,
    personRequired,
    toSel,
    type,
  ]);

  // 必填字段常开：账户必填仅适用于收支；人员必填同样适用于转账。
  useEffect(() => {
    if (type !== "transfer" && acctRequired) setAccountEnabled(true);
    if (personRequired) {
      setPersonEnabled(true);
      if (!personId && peopleOpts[0]?.id) setPersonId(peopleOpts[0].id);
    }
  }, [acctRequired, peopleOpts, personId, personRequired, type]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // 附件加载完成后回显一次：填充既有附件并默认打开附件区域。
  useEffect(() => {
    if (attachmentsHydrated.current) return;
    const records = existingAttachmentsQuery.data;
    if (!records) return;
    attachmentsHydrated.current = true;
    if (records.length === 0) return;
    setExistingAttachments(records.map(recordToAttachmentItem));
    setAttachmentsEnabled(true);
  }, [existingAttachmentsQuery.data]);

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.url) URL.revokeObjectURL(attachment.url);
      }
    },
    [],
  );

  function handleTypeChange(nextType: TransactionType) {
    if (nextType === type) return;
    setType(nextType);
    setCategoryId(null);
    setPrimaryRelationItems([]);
    setLinkedRelationItems([]);
    setPrimaryRelationsEnabled(false);
    setLinkedRelationsEnabled(false);
    if (nextType === "transfer") {
      setAccountEnabled(false);
      setInsuranceEnabled(false);
      setItemEnabled(false);
      setAttachmentsEnabled(false);
    }
  }

  function buildRelations(
    bucket: RelationBucket,
    enabled: boolean,
    items: RecoverablePayableItem[],
  ): TransactionRelationInput[] | null {
    if (!enabled) return [];
    const relations: TransactionRelationInput[] = [];
    for (const item of items) {
      if (!item.accountId) continue;
      const parsed = parseMoneyToMicros(item.amount, { decimalPlaces });
      if (!parsed.ok || !parsed.amountMicros || BigInt(parsed.amountMicros) <= 0n) {
        showToast({ tone: "error", message: "关联项目金额无效" });
        return null;
      }
      const relationAccount = accounts.find((account) => account.id === item.accountId);
      const expectedKind = relationAccountKind(type, bucket);
      if (!relationAccount || relationAccount.type !== expectedKind) {
        showToast({ tone: "error", message: "关联项目类型不正确" });
        return null;
      }
      const relationKind = relationKindFor(type, relationAccount.type);
      if (!relationKind) {
        showToast({ tone: "error", message: "当前交易类型不支持关联" });
        return null;
      }
      relations.push({
        accountId: item.accountId,
        relationKind,
        amountMicros: parsed.amountMicros,
      });
    }
    return relations;
  }

  function buildPayload(): TransactionInput | null {
    const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
    if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
      showToast({ tone: "error", message: "请输入有效金额" });
      return null;
    }

    if (type === "transfer") {
      const from = resolveAccountSelection(accounts, fromSel);
      const to = resolveAccountSelection(accounts, toSel);
      if (!from.accountId || !to.accountId) {
        showToast({ tone: "error", message: "转账需要选择转出和转入账户" });
        return null;
      }
      if (
        from.accountId === to.accountId &&
        (from.subAccountId ?? null) === (to.subAccountId ?? null)
      ) {
        showToast({ tone: "error", message: "转出和转入不能是同一账户" });
        return null;
      }
      if (personRequired && !personId) {
        showToast({ tone: "error", message: "当前账本要求选择人员" });
        return null;
      }
      return {
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
        note: note.trim() || undefined,
      };
    }

    const account = accountEnabled ? resolveAccountSelection(accounts, accountSel) : {};
    if (acctRequired && !account.accountId) {
      showToast({ tone: "error", message: "当前账本要求绑定账户" });
      return null;
    }
    if (personRequired && !personId) {
      showToast({ tone: "error", message: "当前账本要求选择人员" });
      return null;
    }

    const { categoryId: catId, subcategoryId } = resolveCategory(categories, categoryId);
    if (!catId) {
      showToast({ tone: "error", message: "请选择分类" });
      return null;
    }

    const primaryRelations = buildRelations(
      "primary",
      primaryRelationsEnabled,
      primaryRelationItems,
    );
    if (!primaryRelations) return null;
    const linkedRelations = buildRelations("linked", linkedRelationsEnabled, linkedRelationItems);
    if (!linkedRelations) return null;

    const relations = [...primaryRelations, ...linkedRelations];
    return {
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
      relations: relations.length > 0 ? relations : undefined,
    };
  }

  function buildPendingPatch(): PendingPatchBody | null {
    const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
    if (!parsedAmount.ok || !parsedAmount.amountMicros || BigInt(parsedAmount.amountMicros) <= 0n) {
      showToast({ tone: "error", message: "请输入有效金额" });
      return null;
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
        showToast({ tone: "error", message: "转账需要选择转出和转入账户" });
        return null;
      }
      if (
        from.accountId === to.accountId &&
        (from.subAccountId ?? null) === (to.subAccountId ?? null)
      ) {
        showToast({ tone: "error", message: "转出和转入不能是同一账户" });
        return null;
      }
      return {
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
      };
    }
    const { categoryId: catId, subcategoryId } = resolveCategory(categories, categoryId);
    if (!catId) {
      showToast({ tone: "error", message: "请选择分类" });
      return null;
    }
    const account = accountEnabled ? resolveAccountSelection(accounts, accountSel) : {};
    if (acctRequired && !account.accountId) {
      showToast({ tone: "error", message: "当前账本要求绑定账户" });
      return null;
    }
    if (personRequired && !personId) {
      showToast({ tone: "error", message: "当前账本要求选择人员" });
      return null;
    }
    return {
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
    };
  }

  async function postSave(transaction: TransactionDetail) {
    const tasks: Array<Promise<unknown>> = [];
    // 先删除被移除的既有附件（无论附件开关状态，删除都是显式操作）。
    for (const attachmentId of removedAttachmentIds) {
      tasks.push(
        apiRequest(ledgerApiPath(ledgerId, `/attachments/${attachmentId}`), { method: "DELETE" }),
      );
    }
    if (attachmentsEnabled) {
      tasks.push(
        ...attachments.map((attachment) => uploadAttachment(ledgerId, transaction.id, attachment)),
      );
    }
    if (tasks.length > 0) await Promise.all(tasks);
  }

  const mutation = useMutation({
    mutationFn: async (payload: TransactionInput | PendingPatchBody) => {
      if (isPendingMode) {
        // 先保存修改到待确认，再调确认接口生成正式交易。
        await apiRequest(ledgerApiPath(ledgerId, `/auto-pending-transactions/${pending!.id}`), {
          method: "PATCH",
          body: payload,
        });
        return apiRequest<TransactionDetail>(
          ledgerApiPath(ledgerId, `/auto-pending-transactions/${pending!.id}/confirm`),
          { method: "POST" },
        );
      }
      return isEdit
        ? apiRequest<TransactionDetail>(ledgerApiPath(ledgerId, `/transactions/${initial!.id}`), {
            method: "PATCH",
            body: payload,
          })
        : apiRequest<TransactionDetail>(ledgerApiPath(ledgerId, "/transactions"), {
            method: "POST",
            body: payload,
            headers: { "idempotency-key": idempotencyKey.current },
          });
    },
    onSuccess: async (transaction) => {
      if (isPendingMode) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.autoPending(ledgerId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
          queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
          queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
          queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
          queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "stats"] }),
        ]);
        showToast({ tone: "success", message: "已确认入账" });
        // 编辑页在历史里紧邻待确认列表（详情进编辑用 replace 取代了详情），
        // 用 back 直接回到列表，避免残留失效的详情页。
        router.back();
        return;
      }
      let postSaveFailed = false;
      try {
        await postSave(transaction);
      } catch (error) {
        postSaveFailed = true;
        showToast({
          tone: "error",
          message: getApiErrorMessage(error, "记录已保存，部分关联失败"),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "stats"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "attachments"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items(ledgerId) }),
        isEdit
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.transaction(ledgerId, initial!.id),
            })
          : Promise.resolve(),
      ]);
      if (!postSaveFailed) {
        showToast({ tone: "success", message: isEdit ? "已保存修改" : "已记一笔" });
      }
      router.back();
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  useEffect(() => {
    onCanSubmitChange?.(!validationMessage && !mutation.isPending);
    onPendingChange?.(mutation.isPending);
  }, [mutation.isPending, onCanSubmitChange, onPendingChange, validationMessage]);

  useEffect(() => {
    onSubmitBlocked?.(() => {
      showToast({ tone: "error", message: validationMessage ?? "请先补全必填项" });
    });
  }, [onSubmitBlocked, showToast, validationMessage]);

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (validationMessage) {
      showToast({ tone: "error", message: validationMessage });
      return;
    }
    const payload = isPendingMode ? buildPendingPatch() : buildPayload();
    if (payload) mutation.mutate(payload);
  }

  function addAttachments(files: File[]) {
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        file,
      })),
    ]);
  }

  function removeAttachment(id: string) {
    // 既有附件：从展示列表移除并记录待删除 id，保存时再调删除接口。
    if (existingAttachments.some((attachment) => attachment.id === id)) {
      setExistingAttachments((current) => current.filter((attachment) => attachment.id !== id));
      setRemovedAttachmentIds((current) => [...current, id]);
      return;
    }
    setAttachments((current) => {
      const item = current.find((attachment) => attachment.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function openCreateItemSheet() {
    setItemEnabled(true);
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: (
        <ItemEditorSheet
          ledgerId={ledgerId}
          onSaved={(saved) => {
            setSelectedItemId(saved.id);
            setSelectedItemLinkKind("purchase");
            setItemEnabled(true);
          }}
        />
      ),
    });
  }

  if (settingQuery.isPending || categoriesQuery.isPending || accountsQuery.isPending) {
    return <LoadingState rows={5} title="加载记账设置" />;
  }

  const primaryRelationLabel = type === "income" ? "需归还" : "可收回";
  const linkedRelationLabel = type === "income" ? "可收回" : "需归还";
  const primaryRelationHint =
    type === "income" ? "这笔收入中需要归还他人的部分" : "这笔支出中可向他人收回的部分";
  const linkedRelationHint =
    type === "income"
      ? "这笔收入将自动计入选中的可收回项目并参与计算"
      : "这笔支出将自动计入选中的需归还项目并参与计算";

  const renderOrderedField = (field: string) => {
    switch (field) {
      case "category":
        if (type === "transfer") return null;
        return (
          <FieldCard className="transaction-form__picker-card" key="category" label="分类">
            <CategorySelectRow
              onValueChange={setCategoryId}
              options={catOptions}
              value={categoryId}
            />
          </FieldCard>
        );
      case "account":
        if (type === "transfer") {
          return (
            <FieldCard className="transaction-form__picker-card" key="account" label="账户">
              <AccountSelectRow
                label="转出账户"
                onValueChange={setFromSel}
                options={acctOptions}
                placeholder="选择账户"
                value={fromSel}
              />
              <span className="transaction-form__divider" />
              <AccountSelectRow
                label="转入账户"
                onValueChange={setToSel}
                options={acctOptions}
                placeholder="选择账户"
                value={toSel}
              />
            </FieldCard>
          );
        }
        if (!showAccountCard) return null;
        return (
          <ToggleCard
            checked={accountEnabled}
            disabled={acctRequired}
            key="account"
            label="账户"
            onCheckedChange={(checked) => {
              setAccountEnabled(checked);
              if (!checked) setAccountSel(null);
            }}
          >
            <AccountSelectRow
              hideLabel
              label="选择账户"
              onValueChange={setAccountSel}
              options={acctOptions}
              value={accountSel}
            />
          </ToggleCard>
        );
      case "person":
        if (!showPersonCard) return null;
        return (
          <PersonSelectField
            checked={personEnabled}
            disabled={personRequired}
            key="person"
            label="人员"
            onCheckedChange={(checked) => {
              setPersonEnabled(checked);
              if (!checked) setPersonId(null);
            }}
            onValueChange={setPersonId}
            options={peopleOpts}
            value={personId}
          />
        );
      case "date":
        return (
          <FieldCard
            className="transaction-form__date-card"
            key="date"
            label="日期"
            value={formatDateLabel(occurredOn)}
          >
            <DateWheelPicker onValueChange={setOccurredOn} value={occurredOn} />
          </FieldCard>
        );
      case "note":
        if (!showNoteCard) return null;
        return (
          <FieldCard className="transaction-form__note-card" key="note" label="备注">
            <div className="transaction-form__note-row">
              <span>备注</span>
              <Input
                aria-label="备注"
                label="备注"
                maxLength={240}
                onChange={(event) => setNote(event.target.value)}
                placeholder=""
                value={note}
              />
            </div>
          </FieldCard>
        );
      default:
        return null;
    }
  };

  return (
    <form className="transaction-form" id={formId} onSubmit={handleSubmit}>
      <div className="transaction-form__top">
        <Tabs
          className="transaction-form__type-tabs"
          // 待确认模式类型固定（后端确认接口不支持改类型），只显示当前类型页签。
          items={
            isPendingMode ? TYPE_TAB_ITEMS.filter((item) => item.value === type) : TYPE_TAB_ITEMS
          }
          onValueChange={(nextType) => handleTypeChange(nextType as TransactionType)}
          value={type}
        />
        <AmountInput
          className="transaction-form__amount"
          decimalPlaces={decimalPlaces}
          label="金额"
          onValueChange={setAmount}
          value={amount}
        />
      </div>

      <div className="transaction-form__cards">
        {orderedFieldsForType(order, type).map(renderOrderedField)}

        {!isPendingMode && type !== "transfer" ? (
          <>
            <RecoverablePayableEditor
              accountOptions={primaryRelationOpts}
              addLabel={`添加${primaryRelationLabel}项目`}
              emptyText={`还没有${primaryRelationLabel}项目，可到「账户」中先添加${primaryRelationLabel}账户`}
              enabled={primaryRelationsEnabled}
              hint={primaryRelationHint}
              items={primaryRelationItems}
              label={primaryRelationLabel}
              onChange={setPrimaryRelationItems}
              onEnabledChange={setPrimaryRelationsEnabled}
            />

            <RecoverablePayableEditor
              accountOptions={linkedRelationOpts}
              addLabel={`添加${linkedRelationLabel}项目`}
              emptyText={`还没有${linkedRelationLabel}项目，可到「账户」中先添加${linkedRelationLabel}账户`}
              enabled={linkedRelationsEnabled}
              hint={linkedRelationHint}
              items={linkedRelationItems}
              label={`关联${linkedRelationLabel}项目`}
              onChange={setLinkedRelationItems}
              onEnabledChange={setLinkedRelationsEnabled}
            />

            {showAttachmentCard ? (
              <AttachmentPicker
                enabled={attachmentsEnabled}
                items={[...existingAttachments, ...attachments]}
                onEnabledChange={setAttachmentsEnabled}
                onFilesSelected={addAttachments}
                onOpen={(item) => {
                  // 新增附件（本地）直接用 blob URL；既有附件按需拉取内容。
                  if (item.url) return item.url;
                  return createAuthorizedObjectUrl(
                    ledgerApiPath(ledgerId, `/attachments/${item.id}/content`),
                  );
                }}
                onRemove={removeAttachment}
              />
            ) : null}

            <AssetLinkCard
              checked={insuranceEnabled}
              emptyText="还没有保单，可到「我的 · 保险管理」中先添加保单"
              hint={
                type === "income"
                  ? "把这笔收入（如理赔款）关联到一份保单"
                  : "把这笔支出（如保费）关联到一份保单"
              }
              items={insuranceOptions}
              label="保险"
              onCheckedChange={(checked) => {
                setInsuranceEnabled(checked);
                if (!checked) setSelectedInsuranceId(null);
              }}
              onSelect={setSelectedInsuranceId}
              selectedId={selectedInsuranceId}
            />

            <AssetLinkCard
              checked={itemEnabled}
              createLabel="新建物品"
              emptyText="还没有物品，可到「我的 · 物品管理」中先添加物品"
              hint={
                type === "income"
                  ? "把这笔收入（如转卖回款）关联到一件物品"
                  : "把这笔支出（如耗材、维修）关联到一件物品"
              }
              items={itemOptions}
              label="关联物品"
              onCheckedChange={(checked) => {
                setItemEnabled(checked);
                if (!checked) setSelectedItemId(null);
              }}
              onCreate={openCreateItemSheet}
              onSelect={(itemId) => {
                setSelectedItemId(itemId);
                setSelectedItemLinkKind("consumable");
              }}
              selectedId={selectedItemId}
            />
          </>
        ) : null}
      </div>
    </form>
  );
}
