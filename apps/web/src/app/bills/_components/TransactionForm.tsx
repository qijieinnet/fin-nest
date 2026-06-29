"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AmountInput,
  AttachmentPicker,
  DateWheelPicker,
  LoadingState,
  RecoverablePayableEditor,
  type AttachmentItem,
  type BusinessOption,
  type CategoryOption,
  type RecoverablePayableItem,
} from "@/components/business";
import { GlassBottomSheet } from "@/components/glass";
import { ActionButton, Input, Switch, Tabs } from "@/components/ui";
import { CategorySelectionList } from "@/components/business/CategorySelectionList";
import { InlineHint } from "@/components/business/InlineHint";
import { cn } from "@/lib/format/class-names";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type TransactionDetail,
  type TransactionInput,
  type TransactionRelationInput,
  type TransactionType,
  type UploadUrlResult,
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
import {
  useAccounts,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useRecordSetting,
} from "@/lib/data/records";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useToast } from "@/providers";

const DEFAULT_FIELD_ORDER = ["type", "amount", "category", "account", "date", "person", "note"];

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

function relationAccountKind(type: TransactionType, bucket: RelationBucket): "receivable" | "payable" {
  if (type === "income") return bucket === "primary" ? "payable" : "receivable";
  return bucket === "primary" ? "receivable" : "payable";
}

function splitInitialRelations(
  initial: TransactionDetail | undefined,
  decimalPlaces: number,
): Record<RelationBucket, RecoverablePayableItem[]> {
  const buckets: Record<RelationBucket, RecoverablePayableItem[]> = { primary: [], linked: [] };
  for (const relation of initial?.relations ?? []) {
    const bucket =
      relation.relationKind === "receivable_from_expense" || relation.relationKind === "payable_from_income"
        ? "primary"
        : "linked";
    buckets[bucket].push({
      id: relation.id,
      accountId: relation.accountId,
      amount: microsToInput(relation.amountMicros, decimalPlaces),
    });
  }
  return buckets;
}

function formatDateLabel(value: string): string {
  const today = todayKey();
  if (value === today) return "今天";
  return value.replaceAll("-", ".");
}

function nestedOptionLabel(options: Array<{ id: string; label: string; parentId?: string }>, value: string | null, fallback: string): string {
  const selected = options.find((option) => option.id === value);
  if (!selected) return fallback;
  if (!selected.parentId) return selected.label;
  const parent = options.find((option) => option.id === selected.parentId);
  return parent ? `${parent.label}/${selected.label}` : selected.label;
}

async function uploadAttachment(ledgerId: string, transactionId: string, item: PendingAttachment) {
  const mime = item.file.type || "application/octet-stream";
  const upload = await apiRequest<UploadUrlResult>(ledgerApiPath(ledgerId, "/files/upload-url"), {
    method: "POST",
    body: {
      ownerType: "transaction",
      ownerId: transactionId,
      originalName: item.file.name,
      mime,
    },
  });
  const uploaded = await fetch(upload.uploadUrl, {
    method: "PUT",
    body: item.file,
    headers: { "content-type": mime },
  });
  if (!uploaded.ok) throw new Error("附件上传失败");
  await apiRequest(ledgerApiPath(ledgerId, "/attachments"), {
    method: "POST",
    body: {
      ownerType: "transaction",
      ownerId: transactionId,
      originalName: item.file.name,
      mime,
      objectKey: upload.objectKey,
      sizeBytes: String(item.file.size),
    },
  });
}

type FieldCardProps = {
  children?: ReactNode;
  className?: string;
  label: string;
  onClick?: () => void;
  value?: string;
};

function FieldCard({ children, className, label, onClick, value }: FieldCardProps) {
  if (children) {
    return <div className={cn("transaction-form__card", className)}>{children}</div>;
  }
  return (
    <button className={cn("transaction-form__row-card", className)} onClick={onClick} type="button">
      <span>{label}</span>
      <strong>{value}</strong>
      <ChevronRight size={18} />
    </button>
  );
}

type CategorySelectRowProps = {
  onValueChange: (value: string | null) => void;
  options: CategoryOption[];
  value: string | null;
};

function CategorySelectRow({ onValueChange, options, value }: CategorySelectRowProps) {
  const [open, setOpen] = useState(false);
  const displayValue = nestedOptionLabel(options, value, "选择分类");

  return (
    <>
      <button className="transaction-form__select-row" onClick={() => setOpen(true)} type="button">
        <span>分类</span>
        <strong>{displayValue}</strong>
        <ChevronRight size={18} />
      </button>
      <GlassBottomSheet
        className="glass-bottom-sheet--transaction-picker"
        hideDefaultHeader
        onClose={() => setOpen(false)}
        open={open}
      >
        <div className="transaction-form__sheet-header">
          <ActionButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="关闭"
            onClick={() => setOpen(false)}
          />
          <h2>选择分类</h2>
          <span aria-hidden />
        </div>
        <CategorySelectionList
          disableParentWithChildren
          onSelect={(option) => {
            onValueChange(option.id);
            setOpen(false);
          }}
          options={options}
          selectedIds={value ? [value] : []}
        />
      </GlassBottomSheet>
    </>
  );
}

type AccountSelectRowProps = {
  allowClear?: boolean;
  hideLabel?: boolean;
  label: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

function AccountSelectRow({
  allowClear = false,
  hideLabel = false,
  label,
  onValueChange,
  options,
  placeholder = "选择账户",
  value,
}: AccountSelectRowProps) {
  const [open, setOpen] = useState(false);
  const displayValue = nestedOptionLabel(options, value, placeholder);
  const primaryOptions = options.filter((option) => !option.parentId);

  return (
    <>
      <button
        className={cn("transaction-form__select-row", hideLabel && "transaction-form__select-row--value-only")}
        onClick={() => setOpen(true)}
        type="button"
      >
        {hideLabel ? null : <span>{label}</span>}
        <strong>{displayValue}</strong>
        <ChevronRight size={18} />
      </button>
      <GlassBottomSheet
        className="glass-bottom-sheet--transaction-picker"
        onClose={() => setOpen(false)}
        open={open}
        title={label}
      >
        <div className="transaction-form__option-list">
          {primaryOptions.map((option) => {
            const children = options.filter((child) => child.parentId === option.id);
            const selected = option.id === value;
            return (
              <section className="transaction-form__option-group" key={option.id}>
                <button
                  aria-selected={selected}
                  className="transaction-form__option-row"
                  disabled={option.disabled}
                  onClick={() => {
                    onValueChange(option.id);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={16} strokeWidth={3} /> : null}
                </button>
                {children.length > 0 ? (
                  <div className="transaction-form__suboption-list">
                    {children.map((child) => {
                      const childSelected = child.id === value;
                      return (
                        <button
                          aria-selected={childSelected}
                          className="transaction-form__option-row transaction-form__option-row--sub"
                          disabled={child.disabled}
                          key={child.id}
                          onClick={() => {
                            onValueChange(child.id);
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <span>{child.label}</span>
                          {childSelected ? <Check size={16} strokeWidth={3} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          {allowClear && value ? (
            <button
              className="transaction-form__option-row transaction-form__option-row--clear"
              onClick={() => {
                onValueChange(null);
                setOpen(false);
              }}
              type="button"
            >
              <span>清除选项</span>
            </button>
          ) : null}
        </div>
      </GlassBottomSheet>
    </>
  );
}

type ToggleCardProps = {
  children?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

function ToggleCard({ children, checked, disabled, hint, label, onCheckedChange }: ToggleCardProps) {
  return (
    <div className="transaction-form__card">
      <div className="transaction-form__toggle-head">
        <span>
          <strong>
            {label}
            {hint ? <InlineHint text={hint} /> : null}
          </strong>
        </span>
        <Switch checked={checked} disabled={disabled} label={label} onCheckedChange={onCheckedChange} />
      </div>
      {checked ? <div className="transaction-form__toggle-body">{children}</div> : null}
    </div>
  );
}

type AssetLinkCardProps = {
  checked: boolean;
  emptyText: string;
  hint: string;
  items: Array<{ id: string; icon: string; name: string }>;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
};

function AssetLinkCard({
  checked,
  emptyText,
  hint,
  items,
  label,
  onCheckedChange,
  onSelect,
  selectedId,
}: AssetLinkCardProps) {
  return (
    <ToggleCard checked={checked} hint={hint} label={label} onCheckedChange={onCheckedChange}>
      {items.length === 0 ? (
        <p className="transaction-form__empty-text">{emptyText}</p>
      ) : (
        <div className="transaction-form__chip-row">
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                className={cn("transaction-form__chip", selected && "transaction-form__chip--selected")}
                key={item.id}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <span>{item.icon}</span>
                {item.name}
              </button>
            );
          })}
        </div>
      )}
    </ToggleCard>
  );
}

export type TransactionSeed = {
  type?: TransactionType;
  grossAmountMicros?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  personId?: string | null;
  accountId?: string | null;
  subAccountId?: string | null;
  note?: string | null;
};

type TransactionFormProps = {
  formId?: string;
  ledgerId: string;
  initial?: TransactionDetail;
  onCanSubmitChange?: (canSubmit: boolean) => void;
  onSubmitBlocked?: (submitBlocked: () => void) => void;
  onPendingChange?: (pending: boolean) => void;
  seed?: TransactionSeed;
};

export function TransactionForm({
  formId,
  initial,
  ledgerId,
  onCanSubmitChange,
  onPendingChange,
  onSubmitBlocked,
  seed,
}: TransactionFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isEdit = Boolean(initial);

  const settingQuery = useRecordSetting(ledgerId);
  const categoriesQuery = useCategories(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);

  const setting = settingQuery.data;
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const decimalPlaces = setting?.amountDecimalPlaces ?? 2;
  const idempotencyKey = useRef(crypto.randomUUID());

  const seedAmountMicros = initial?.grossAmountMicros ?? seed?.grossAmountMicros ?? null;
  const seedAccountSelection = accountSelectionId(
    initial?.accountId ?? seed?.accountId,
    initial?.subAccountId ?? seed?.subAccountId,
  );
  const initialBuckets = useMemo(
    () => splitInitialRelations(initial, decimalPlaces),
    [decimalPlaces, initial],
  );

  const [type, setType] = useState<TransactionType>(initial?.type ?? seed?.type ?? "expense");
  const [amount, setAmount] = useState(() =>
    seedAmountMicros ? microsToInput(seedAmountMicros, decimalPlaces) : "",
  );
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn?.slice(0, 10) ?? todayKey());
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.subcategoryId ?? initial?.categoryId ?? seed?.subcategoryId ?? seed?.categoryId ?? null,
  );
  const [personId, setPersonId] = useState<string | null>(initial?.personId ?? seed?.personId ?? null);
  const [accountSel, setAccountSel] = useState<string | null>(seedAccountSelection);
  const [fromSel, setFromSel] = useState<string | null>(
    accountSelectionId(initial?.fromAccountId, initial?.fromSubAccountId),
  );
  const [toSel, setToSel] = useState<string | null>(
    accountSelectionId(initial?.toAccountId, initial?.toSubAccountId),
  );
  const [note, setNote] = useState(initial?.note ?? seed?.note ?? "");
  const [accountEnabled, setAccountEnabled] = useState(Boolean(seedAccountSelection));
  const [personEnabled, setPersonEnabled] = useState(Boolean(initial?.personId ?? seed?.personId));
  const [primaryRelationsEnabled, setPrimaryRelationsEnabled] = useState(initialBuckets.primary.length > 0);
  const [linkedRelationsEnabled, setLinkedRelationsEnabled] = useState(initialBuckets.linked.length > 0);
  const [primaryRelationItems, setPrimaryRelationItems] = useState<RecoverablePayableItem[]>(initialBuckets.primary);
  const [linkedRelationItems, setLinkedRelationItems] = useState<RecoverablePayableItem[]>(initialBuckets.linked);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  // 编辑模式下，回显已有的保险/物品关联（后端关联为 upsert 幂等，重新保存不会重复）。
  const initialInsuranceId = initial?.links?.find((link) => link.linkedType === "insurance")?.linkedId ?? null;
  const initialItemId = initial?.links?.find((link) => link.linkedType === "item")?.linkedId ?? null;
  const [insuranceEnabled, setInsuranceEnabled] = useState(Boolean(initialInsuranceId));
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(initialInsuranceId);
  const [itemEnabled, setItemEnabled] = useState(Boolean(initialItemId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId);

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
  const showPersonCard = type !== "transfer" && visibleFields.person !== false;
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
      if (from.accountId === to.accountId && (from.subAccountId ?? null) === (to.subAccountId ?? null)) {
        return "转出和转入不能是同一账户";
      }
      return null;
    }
    if (acctRequired && !resolveAccountSelection(accounts, accountSel).accountId) {
      return "当前账本要求绑定账户";
    }
    if (personRequired && !personId) {
      return "当前账本要求选择人员";
    }
    return null;
  }, [accountSel, accounts, acctRequired, amount, decimalPlaces, fromSel, personId, personRequired, toSel, type]);

  useEffect(() => {
    if (acctRequired) setAccountEnabled(true);
    if (personRequired) setPersonEnabled(true);
  }, [acctRequired, personRequired]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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
      setPersonEnabled(false);
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
      relations.push({ accountId: item.accountId, relationKind, amountMicros: parsed.amountMicros });
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
      if (from.accountId === to.accountId && (from.subAccountId ?? null) === (to.subAccountId ?? null)) {
        showToast({ tone: "error", message: "转出和转入不能是同一账户" });
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

    const primaryRelations = buildRelations("primary", primaryRelationsEnabled, primaryRelationItems);
    if (!primaryRelations) return null;
    const linkedRelations = buildRelations("linked", linkedRelationsEnabled, linkedRelationItems);
    if (!linkedRelations) return null;

    const { categoryId: catId, subcategoryId } = resolveCategory(categories, categoryId);
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
      relations: relations.length > 0 ? relations : undefined,
    };
  }

  async function postSave(transaction: TransactionDetail) {
    const tasks: Array<Promise<unknown>> = [];
    if (insuranceEnabled && selectedInsuranceId) {
      tasks.push(
        apiRequest(ledgerApiPath(ledgerId, `/insurances/${selectedInsuranceId}/transactions`), {
          method: "POST",
          body: { transactionId: transaction.id },
        }),
      );
    }
    if (itemEnabled && selectedItemId) {
      tasks.push(
        apiRequest(ledgerApiPath(ledgerId, `/items/${selectedItemId}/transactions`), {
          method: "POST",
          body: { transactionId: transaction.id },
        }),
      );
    }
    if (attachmentsEnabled) {
      tasks.push(...attachments.map((attachment) => uploadAttachment(ledgerId, transaction.id, attachment)));
    }
    if (tasks.length > 0) await Promise.all(tasks);
  }

  const mutation = useMutation({
    mutationFn: (payload: TransactionInput) =>
      isEdit
        ? apiRequest<TransactionDetail>(ledgerApiPath(ledgerId, `/transactions/${initial!.id}`), {
            method: "PATCH",
            body: payload,
          })
        : apiRequest<TransactionDetail>(ledgerApiPath(ledgerId, "/transactions"), {
            method: "POST",
            body: payload,
            headers: { "idempotency-key": idempotencyKey.current },
          }),
    onSuccess: async (transaction) => {
      let postSaveFailed = false;
      try {
        await postSave(transaction);
      } catch (error) {
        postSaveFailed = true;
        showToast({ tone: "error", message: getApiErrorMessage(error, "记录已保存，部分关联失败") });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items(ledgerId) }),
        isEdit
          ? queryClient.invalidateQueries({ queryKey: queryKeys.transaction(ledgerId, initial!.id) })
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
    const payload = buildPayload();
    if (payload) mutation.mutate(payload);
  }

  function addAttachments(files: File[]) {
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        file,
      })),
    ]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const item = current.find((attachment) => attachment.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  if (settingQuery.isPending || categoriesQuery.isPending || accountsQuery.isPending) {
    return <LoadingState rows={5} title="加载记账设置" />;
  }

  const primaryRelationLabel = type === "income" ? "需归还" : "可收回";
  const linkedRelationLabel = type === "income" ? "可收回" : "需归还";
  const primaryRelationHint =
    type === "income"
      ? "这笔收入中需要归还他人的部分"
      : "这笔支出中可向他人收回的部分";
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
            <CategorySelectRow onValueChange={setCategoryId} options={catOptions} value={categoryId} />
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
            label={acctRequired ? "账户（必填）" : "账户"}
            onCheckedChange={(checked) => {
              setAccountEnabled(checked);
              if (!checked) setAccountSel(null);
            }}
          >
            <AccountSelectRow
              allowClear
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
          <ToggleCard
            checked={personEnabled}
            disabled={personRequired}
            key="person"
            label={personRequired ? "人员（必填）" : "人员"}
            onCheckedChange={(checked) => {
              setPersonEnabled(checked);
              if (!checked) setPersonId(null);
            }}
          >
            <div className="transaction-form__people-row">
              {peopleOpts.map((person) => {
                const selected = person.id === personId;
                return (
                  <button
                    className={cn("transaction-form__chip", selected && "transaction-form__chip--selected")}
                    key={person.id}
                    onClick={() => setPersonId(person.id)}
                    type="button"
                  >
                    {person.label}
                  </button>
                );
              })}
            </div>
          </ToggleCard>
        );
      case "date":
        return (
          <FieldCard className="transaction-form__date-card" key="date" label="日期" value={formatDateLabel(occurredOn)}>
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
                placeholder="选填…"
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
          items={[
            { label: "支出", value: "expense" },
            { label: "收入", value: "income" },
            { label: "转账", value: "transfer" },
          ]}
          onValueChange={(nextType) => handleTypeChange(nextType as TransactionType)}
          value={type}
        />
        <AmountInput
          className={cn("transaction-form__amount", type === "income" && "transaction-form__amount--income")}
          decimalPlaces={decimalPlaces}
          label="金额"
          onValueChange={setAmount}
          value={amount}
        />
      </div>

      <div className="transaction-form__cards">
        {order.filter((field) => field !== "type" && field !== "amount").map(renderOrderedField)}

        {type !== "transfer" ? (
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
                items={attachments}
                onEnabledChange={setAttachmentsEnabled}
                onFilesSelected={addAttachments}
                onOpen={(item) => {
                  if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
                }}
                onRemove={removeAttachment}
              />
            ) : null}

            <AssetLinkCard
              checked={insuranceEnabled}
              emptyText="还没有保单，可到「我的 · 保险管理」中先添加保单"
              hint={type === "income" ? "把这笔收入（如理赔款）关联到一份保单" : "把这笔支出（如保费）关联到一份保单"}
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
              emptyText="还没有物品，可到「我的 · 物品管理」中先添加物品"
              hint={type === "income" ? "把这笔收入（如转卖回款）关联到一件物品" : "把这笔支出（如耗材、维修）关联到一件物品"}
              items={itemOptions}
              label="关联物品"
              onCheckedChange={(checked) => {
                setItemEnabled(checked);
                if (!checked) setSelectedItemId(null);
              }}
              onSelect={setSelectedItemId}
              selectedId={selectedItemId}
            />
          </>
        ) : null}
      </div>

    </form>
  );
}
