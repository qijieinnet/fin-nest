"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AttachmentItem, RecoverablePayableItem } from "@/components/business";
import {
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  uploadAttachmentFile,
  type AutoPendingTransaction,
  type TransactionDetail,
  type TransactionInput,
  type TransactionType,
} from "@/lib/api";
import {
  accountSelectionId,
  categoryOptions,
  moneyAccountOptions,
  personOptions,
  relationAccountOptions,
} from "@/lib/data/options";
import { effectiveFieldOrder } from "@/lib/data/field-order";
import {
  useAccounts,
  useAttachments,
  useCategories,
  useInsurances,
  useItems,
  useItemTypes,
  usePeople,
  useRecordSetting,
  useSubscriptionCategories,
  useSubscriptions,
} from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { microsToInput } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useDecimalPlaces, useToast } from "@/providers";
import { insuranceTypeMeta } from "../../../more/insurances/_components/insurance-utils";
import { formatDateLabel, typeGlyph } from "../../../more/items/_components/item-utils";
import { categoryGlyph } from "../../../more/subscriptions/_components/subscription-utils";
import {
  buildPayload,
  buildPendingPatch,
  computeValidationMessage,
  recordToAttachmentItem,
  relationAccountKind,
  splitInitialRelations,
  todayKey,
  type PendingAttachment,
  type PendingPatchBody,
} from "./transaction-form-utils";

export type TransactionSeed = {
  type?: TransactionType;
  /** 记账日期（YYYY-MM-DD）。选择快捷模板时用于保留用户已选日期，不随模板重置为今天。 */
  occurredOn?: string | null;
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
  /** 关联物品的方式（快捷模板可指定）；为空按「耗材」处理。 */
  itemLinkKind?: "consumable" | "purchase" | null;
  subscriptionId?: string | null;
};

export type UseTransactionFormModelParams = {
  ledgerId: string;
  initial?: TransactionDetail;
  /** AI 草稿编辑等跨页面流程可复用外部幂等键。 */
  idempotencyKeyOverride?: string;
  /** 保存后必须完成外部回写，不受连续记账设置影响。 */
  completeAfterSave?: boolean;
  onCanSubmitChange?: (canSubmit: boolean) => void;
  onSaved?: (transaction: TransactionDetail) => void | Promise<void>;
  onSubmitBlocked?: (submitBlocked: () => void) => void;
  onPendingChange?: (pending: boolean) => void;
  /** 记账日期变化时回调，父层据此在选择快捷模板（表单重挂载）时保留用户已选日期。 */
  onOccurredOnChange?: (occurredOn: string) => void;
  pending?: AutoPendingTransaction;
  seed?: TransactionSeed;
};

async function uploadAttachment(ledgerId: string, transactionId: string, item: PendingAttachment) {
  await uploadAttachmentFile(ledgerId, "transaction", transactionId, item.file);
}

export function useTransactionFormModel({
  completeAfterSave = false,
  idempotencyKeyOverride,
  initial,
  ledgerId,
  onCanSubmitChange,
  onOccurredOnChange,
  onPendingChange,
  onSaved,
  onSubmitBlocked,
  pending,
  seed,
}: UseTransactionFormModelParams) {
  const router = useAppRouter();
  const queryClient = useQueryClient();
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
  const itemTypesQuery = useItemTypes(ledgerId);
  const subscriptionsQuery = useSubscriptions(ledgerId);
  const subscriptionCategoriesQuery = useSubscriptionCategories(ledgerId);

  const setting = settingQuery.data;
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const decimalPlaces = useDecimalPlaces();
  const idempotencyKey = useRef(idempotencyKeyOverride ?? createClientId("transaction"));

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
    seedAmountMicros ? microsToInput(seedAmountMicros, { decimalPlaces, omitZeroFraction: false }) : "",
  );
  const [occurredOn, setOccurredOn] = useState(
    initial?.occurredOn?.slice(0, 10) ??
      pending?.scheduledFor?.slice(0, 10) ??
      seed?.occurredOn?.slice(0, 10) ??
      todayKey(),
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
  // 保存成功计数：连续记账下页面/键盘不关，键盘据此把页签切回金额，准备记下一笔。
  const [savedCount, setSavedCount] = useState(0);
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
  const initialSubscriptionLink = initial?.links?.find(
    (link) => link.linkedType === "subscription",
  );
  const initialInsuranceId = initialInsuranceLink?.linkedId ?? seed?.insuranceId ?? null;
  const initialItemId = initialItemLink?.linkedId ?? seed?.itemId ?? null;
  const initialSubscriptionId = initialSubscriptionLink?.linkedId ?? seed?.subscriptionId ?? null;
  const [insuranceEnabled, setInsuranceEnabled] = useState(Boolean(initialInsuranceId));
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(initialInsuranceId);
  const [itemEnabled, setItemEnabled] = useState(Boolean(initialItemId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(Boolean(initialSubscriptionId));
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(
    initialSubscriptionId,
  );
  const [selectedItemLinkKind, setSelectedItemLinkKind] = useState<"consumable" | "purchase">(
    (initialItemLink?.linkKind ?? seed?.itemLinkKind) === "purchase" ? "purchase" : "consumable",
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
  const insuranceOptions = useMemo(() => {
    const personById = new Map((peopleQuery.data ?? []).map((person) => [person.id, person.name]));
    return (insurancesQuery.data ?? [])
      .filter((insurance) => !insurance.terminatedAt)
      .map((insurance) => {
        const meta = insuranceTypeMeta(insurance.type);
        const insuredNames = (insurance.insuredPeople ?? [])
          .map((entry) => personById.get(entry.personId))
          .filter((name): name is string => Boolean(name));
        return {
          description: `${insuredNames.length > 0 ? `${insuredNames.join("、")}` : "未指定被保人"} · ${meta.label}`,
          id: insurance.id,
          icon: meta.icon,
          name: insurance.name,
        };
      });
  }, [insurancesQuery.data, peopleQuery.data]);
  const itemTypeById = useMemo(
    () => new Map((itemTypesQuery.data ?? []).map((itemType) => [itemType.id, itemType])),
    [itemTypesQuery.data],
  );
  const itemOptions = useMemo(
    () =>
      (itemsQuery.data ?? []).map((item) => {
        const itemType = item.typeId ? itemTypeById.get(item.typeId) : null;
        const descriptionParts = [
          itemType?.name,
          item.purchaseDate ? `${formatDateLabel(item.purchaseDate)}` : null,
        ].filter(Boolean);
        return {
          id: item.id,
          icon: typeGlyph(itemType),
          name: item.name,
          description: descriptionParts.length > 0 ? descriptionParts.join(" · ") : undefined,
        };
      }),
    [itemTypeById, itemsQuery.data],
  );
  const subscriptionCategoryById = useMemo(
    () =>
      new Map((subscriptionCategoriesQuery.data ?? []).map((category) => [category.id, category])),
    [subscriptionCategoriesQuery.data],
  );
  const subscriptionOptions = useMemo(
    () =>
      (subscriptionsQuery.data ?? [])
        .filter((subscription) => !subscription.terminatedAt)
        .map((subscription) => ({
          id: subscription.id,
          icon: categoryGlyph(
            subscription.categoryId ? subscriptionCategoryById.get(subscription.categoryId) : null,
          ),
          name: subscription.name,
        })),
    [subscriptionCategoryById, subscriptionsQuery.data],
  );

  const visibleFields = setting?.visibleFields ?? {};
  const order = effectiveFieldOrder(setting);
  const acctRequired = setting?.acctRequired ?? false;
  const personRequired = setting?.personRequired ?? false;
  const continuousEntry = setting?.continuousEntry ?? false;
  const keypadAutoOpen = setting?.keypadAutoOpen ?? false;
  const showAccountCard = type !== "transfer" && visibleFields.account !== false;
  const showPersonCard = visibleFields.person !== false;
  const showNoteCard = visibleFields.note !== false;
  const showAttachmentCard = type !== "transfer" && visibleFields.attachments !== false;

  const validationMessage = useMemo(
    () =>
      computeValidationMessage({
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
      }),
    [
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
    ],
  );

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
      setSubscriptionEnabled(false);
      setAttachmentsEnabled(false);
    }
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
      setSavedCount((current) => current + 1);
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
        if (onSaved) await onSaved(transaction);
        else router.back();
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
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions(ledgerId) }),
        isEdit
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.transaction(ledgerId, initial!.id),
            })
          : Promise.resolve(),
      ]);
      if (!postSaveFailed) {
        showToast({ tone: "success", message: isEdit ? "已保存修改" : "已记一笔" });
      }
      // 新建且开启连续记账：保留页面继续记下一笔，不触发关闭/返回。
      if (!isEdit && continuousEntry && !completeAfterSave) {
        resetForContinuousEntry();
        return;
      }
      if (onSaved) await onSaved(transaction);
      else router.back();
    },  });

  useEffect(() => {
    onCanSubmitChange?.(!validationMessage && !mutation.isPending);
    onPendingChange?.(mutation.isPending);
  }, [mutation.isPending, onCanSubmitChange, onPendingChange, validationMessage]);

  useEffect(() => {
    onSubmitBlocked?.(() => {
      showToast({ tone: "error", message: validationMessage ?? "请先补全必填项" });
    });
  }, [onSubmitBlocked, showToast, validationMessage]);

  useEffect(() => {
    onOccurredOnChange?.(occurredOn);
  }, [occurredOn, onOccurredOnChange]);

  // 连续记账：提交成功后不关闭页面，清空本次输入，仅保留日期、分类、人员。
  function resetForContinuousEntry() {
    setAmount("");
    setNote("");
    setAccountEnabled(false);
    setAccountSel(null);
    setFromSel(null);
    setToSel(null);
    setPrimaryRelationsEnabled(false);
    setLinkedRelationsEnabled(false);
    setPrimaryRelationItems([]);
    setLinkedRelationItems([]);
    for (const attachment of attachmentsRef.current) {
      if (attachment.url) URL.revokeObjectURL(attachment.url);
    }
    setAttachments([]);
    setExistingAttachments([]);
    setRemovedAttachmentIds([]);
    setAttachmentsEnabled(false);
    setInsuranceEnabled(false);
    setSelectedInsuranceId(null);
    setItemEnabled(false);
    setSelectedItemId(null);
    setSubscriptionEnabled(false);
    setSelectedSubscriptionId(null);
    // 幂等键用于去重，下一笔必须换新键，否则会被服务端判定为重复提交。
    idempotencyKey.current = createClientId("transaction");
  }

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (validationMessage) {
      showToast({ tone: "error", message: validationMessage });
      return;
    }
    const result = isPendingMode
      ? buildPendingPatch({
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
        })
      : buildPayload({
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
        });
    if (!result.ok) {
      showToast({ tone: "error", message: result.message });
      return;
    }
    mutation.mutate(result.value);
  }

  function addAttachments(files: File[]) {
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        // 新选附件用本地 blob URL 预览/下载（含 PDF/视频等）；其 id 是客户端临时 id，
        // 尚未落库，绝不能拿它去请求服务器 /attachments/:id/content。
        url: URL.createObjectURL(file),
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

  /** 附件打开：新增附件（本地）直接用 blob URL；既有附件按需拉取内容。 */
  function openAttachment(item: AttachmentItem): string | Promise<string> {
    if (item.url) return item.url;
    return createAuthorizedObjectUrl(ledgerApiPath(ledgerId, `/attachments/${item.id}/content`));
  }

  /** 新建物品并直接关联（作为购入登记）。 */
  function applyCreatedItem(saved: { id: string }) {
    setSelectedItemId(saved.id);
    setSelectedItemLinkKind("purchase");
    setItemEnabled(true);
  }

  const isLoading = settingQuery.isPending || categoriesQuery.isPending || accountsQuery.isPending;

  return {
    // 加载态
    isLoading,
    isPendingMode,
    ledgerId,
    // 顶部字段
    type,
    amount,
    setAmount,
    handleTypeChange,
    // 有序字段
    order,
    categoryId,
    setCategoryId,
    catOptions,
    acctOptions,
    fromSel,
    setFromSel,
    toSel,
    setToSel,
    accountSel,
    setAccountSel,
    accountEnabled,
    setAccountEnabled,
    personId,
    setPersonId,
    personEnabled,
    setPersonEnabled,
    peopleOpts,
    occurredOn,
    setOccurredOn,
    note,
    setNote,
    // 字段展示控制
    acctRequired,
    personRequired,
    keypadAutoOpen,
    showAccountCard,
    showPersonCard,
    showNoteCard,
    showAttachmentCard,
    // 关联项
    primaryRelationsEnabled,
    setPrimaryRelationsEnabled,
    primaryRelationItems,
    setPrimaryRelationItems,
    primaryRelationOpts,
    linkedRelationsEnabled,
    setLinkedRelationsEnabled,
    linkedRelationItems,
    setLinkedRelationItems,
    linkedRelationOpts,
    // 附件
    attachmentsEnabled,
    setAttachmentsEnabled,
    attachmentItems: [...existingAttachments, ...attachments] as AttachmentItem[],
    addAttachments,
    removeAttachment,
    openAttachment,
    // 资产关联
    insuranceEnabled,
    setInsuranceEnabled,
    selectedInsuranceId,
    setSelectedInsuranceId,
    insuranceOptions,
    itemEnabled,
    setItemEnabled,
    selectedItemId,
    setSelectedItemId,
    setSelectedItemLinkKind,
    itemOptions,
    applyCreatedItem,
    subscriptionEnabled,
    setSubscriptionEnabled,
    selectedSubscriptionId,
    setSelectedSubscriptionId,
    subscriptionOptions,
    // 提交
    decimalPlaces,
    validationMessage,
    handleSubmit,
    savedCount,
    mutationState: { isPending: mutation.isPending },
  };
}

export type TransactionFormModel = ReturnType<typeof useTransactionFormModel>;

/** 双端渲染层共享的 props：视图模型 + 由外层受控的「新建物品」弹层动作（含 JSX，留在组件层）。 */
export type TransactionFormRenderProps = {
  model: TransactionFormModel;
  openCreateItemSheet: () => void;
};
