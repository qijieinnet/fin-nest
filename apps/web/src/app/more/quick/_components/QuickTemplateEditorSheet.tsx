"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AccountSelectRow,
  AmountInput,
  AssetLinkCard,
  CategorySelectRow,
  FieldCard,
  PersonSelectField,
  RecoverablePayableEditor,
  ToggleCard,
  type RecoverablePayableItem,
} from "@/components/business";
import { IconButton, Input, Switch, Tabs } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AutoRelation,
  type Category,
  type Insurance,
  type ItemAsset,
  type Person,
  type QuickTemplate,
  type TransactionType,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
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
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

type QuickTemplateEditorSheetProps = {
  accounts: Account[];
  categories: Category[];
  insurances: Insurance[];
  items: ItemAsset[];
  ledgerId: string;
  people: Person[];
  template?: QuickTemplate;
};

type RelationBucket = "primary" | "linked";

const TYPE_ITEMS = [
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
  { label: "转账", value: "transfer" },
];

/** 交易类型 + 关联桶（主/联动）对应的账户类型（可收回/需归还）。 */
function relationAccountKind(
  type: TransactionType,
  bucket: RelationBucket,
): "receivable" | "payable" {
  if (type === "income") return bucket === "primary" ? "payable" : "receivable";
  return bucket === "primary" ? "receivable" : "payable";
}

/** 把模板里已存的关联拆回「主项目 / 联动项目」两个编辑桶。 */
function splitRelationBuckets(
  relations: AutoRelation[] | null | undefined,
  toInput: (micros: string) => string,
): Record<RelationBucket, RecoverablePayableItem[]> {
  const buckets: Record<RelationBucket, RecoverablePayableItem[]> = { primary: [], linked: [] };
  for (const relation of relations ?? []) {
    const bucket =
      relation.relationKind === "receivable_from_expense" ||
      relation.relationKind === "payable_from_income"
        ? "primary"
        : "linked";
    buckets[bucket].push({
      id: createClientId("relation"),
      accountId: relation.accountId,
      amount: toInput(relation.amountMicros),
    });
  }
  return buckets;
}

function microsToInput(micros: string | null | undefined): string {
  if (!micros) return "";
  const value = BigInt(micros);
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n) / 10_000n;
  return fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
}

function resolveCategory(
  categories: Category[],
  selectedId: string | null,
): { categoryId?: string; subcategoryId?: string } {
  if (!selectedId) return {};
  for (const category of categories) {
    if (category.id === selectedId) return { categoryId: category.id };
    const sub = category.subcategories.find((item) => item.id === selectedId);
    if (sub) return { categoryId: category.id, subcategoryId: sub.id };
  }
  return {};
}

function firstCategoryId(categories: Category[], type: "expense" | "income"): string | null {
  const first = categories.find((category) => category.type === type);
  return (
    first?.subcategories.find((subcategory) => !subcategory.archivedAt)?.id ?? first?.id ?? null
  );
}

export function QuickTemplateEditorSheet({
  accounts,
  categories,
  insurances,
  items,
  ledgerId,
  people,
  template,
}: QuickTemplateEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(template);

  const [type, setType] = useState<TransactionType>(template?.type ?? "expense");
  const [name, setName] = useState(template?.name ?? "");
  const [amount, setAmount] = useState(() => microsToInput(template?.amountMicros));
  const [categoryId, setCategoryId] = useState<string | null>(
    template?.type === "transfer"
      ? null
      : (template?.subcategoryId ??
          template?.categoryId ??
          firstCategoryId(categories, template?.type === "income" ? "income" : "expense")),
  );
  const [accountEnabled, setAccountEnabled] = useState(Boolean(template?.accountId));
  const [accountId, setAccountId] = useState<string | null>(
    accountSelectionId(template?.accountId, template?.subAccountId),
  );
  const [fromAccountId, setFromAccountId] = useState<string | null>(
    accountSelectionId(template?.fromAccountId, template?.fromSubAccountId),
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    accountSelectionId(template?.toAccountId, template?.toSubAccountId),
  );
  const [personEnabled, setPersonEnabled] = useState(Boolean(template?.personId));
  const [personId, setPersonId] = useState<string | null>(template?.personId ?? null);
  const [note, setNote] = useState(template?.note ?? "");
  const initialBuckets = useMemo(
    () => splitRelationBuckets(template?.relationPayload, microsToInput),
    [template?.relationPayload],
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
  const [insuranceEnabled, setInsuranceEnabled] = useState(Boolean(template?.insuranceId));
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(
    template?.insuranceId ?? null,
  );
  const [itemEnabled, setItemEnabled] = useState(Boolean(template?.itemId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(template?.itemId ?? null);
  const [directEnabled, setDirectEnabled] = useState(template?.directEnabled ?? false);

  const catOptions = useMemo(
    () => categoryOptions(categories, type === "income" ? "income" : "expense"),
    [categories, type],
  );
  const acctOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const peopleOptions = useMemo(() => personOptions(people), [people]);
  const primaryRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "primary")),
    [accounts, type],
  );
  const linkedRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "linked")),
    [accounts, type],
  );
  const insuranceOptions = useMemo(
    () => insurances.map((insurance) => ({ id: insurance.id, icon: "保", name: insurance.name })),
    [insurances],
  );
  const itemOptions = useMemo(
    () => items.map((item) => ({ id: item.id, icon: "物", name: item.name })),
    [items],
  );
  const primaryRelationLabel = type === "income" ? "需归还" : "可收回";
  const linkedRelationLabel = type === "income" ? "可收回" : "需归还";

  function handleTypeChange(nextType: TransactionType) {
    if (nextType === type) return;
    setType(nextType);
    // 关联类型随收支方向变化，切换时清空避免残留不匹配的关联。
    setPrimaryRelationItems([]);
    setLinkedRelationItems([]);
    setPrimaryRelationsEnabled(false);
    setLinkedRelationsEnabled(false);
    if (nextType === "transfer") {
      setCategoryId(null);
      setAccountEnabled(false);
      setAccountId(null);
      setInsuranceEnabled(false);
      setSelectedInsuranceId(null);
      setItemEnabled(false);
      setSelectedItemId(null);
      return;
    }
    setCategoryId(firstCategoryId(categories, nextType === "income" ? "income" : "expense"));
  }

  function buildRelations(
    bucket: RelationBucket,
    enabled: boolean,
    relationItems: RecoverablePayableItem[],
  ) {
    if (!enabled) return [];
    const relations: AutoRelation[] = [];
    for (const item of relationItems) {
      if (!item.accountId) continue;
      const parsed = parseMoneyToMicros(item.amount);
      if (!parsed.ok || BigInt(parsed.amountMicros) <= 0n) throw new Error("关联项目金额无效");
      const relationAccount = accounts.find((account) => account.id === item.accountId);
      const expectedKind = relationAccountKind(type, bucket);
      if (!relationAccount || relationAccount.type !== expectedKind)
        throw new Error("关联项目类型不正确");
      const relationKind = relationKindFor(type, relationAccount.type);
      if (!relationKind) throw new Error("当前交易类型不支持关联");
      relations.push({
        accountId: item.accountId,
        relationKind,
        amountMicros: parsed.amountMicros,
      });
    }
    return relations;
  }

  const parsedAmount = parseMoneyToMicros(amount);
  const hasAmount = amount.trim().length > 0;
  const amountMicros = hasAmount && parsedAmount.ok ? parsedAmount.amountMicros : null;
  const category = resolveCategory(categories, categoryId);
  const fromAccount = resolveAccountSelection(accounts, fromAccountId);
  const toAccount = resolveAccountSelection(accounts, toAccountId);
  const transferReady =
    type === "transfer" &&
    Boolean(fromAccount.accountId) &&
    Boolean(toAccount.accountId) &&
    !(
      fromAccount.accountId === toAccount.accountId &&
      (fromAccount.subAccountId ?? null) === (toAccount.subAccountId ?? null)
    );
  const canSubmit =
    (type === "transfer" ? transferReady : Boolean(category.categoryId)) &&
    (!hasAmount || parsedAmount.ok);

  const save = useMutation({
    mutationFn: () => {
      const isTransfer = type === "transfer";
      if (!isTransfer && !category.categoryId) throw new Error("请选择分类");
      if (isTransfer && !transferReady) throw new Error("请选择转出和转入账户");
      if (hasAmount && (!parsedAmount.ok || BigInt(parsedAmount.amountMicros) <= 0n)) {
        throw new Error("请输入有效金额");
      }
      const account =
        !isTransfer && accountEnabled ? resolveAccountSelection(accounts, accountId) : {};
      const relations = isTransfer
        ? []
        : [
            ...buildRelations("primary", primaryRelationsEnabled, primaryRelationItems),
            ...buildRelations("linked", linkedRelationsEnabled, linkedRelationItems),
          ];
      const body = {
        type,
        name: name.trim() || undefined,
        amountMicros: amountMicros ?? undefined,
        categoryId: isTransfer ? null : category.categoryId,
        subcategoryId: isTransfer ? null : (category.subcategoryId ?? undefined),
        accountId: isTransfer ? null : (account.accountId ?? undefined),
        subAccountId: isTransfer ? null : (account.subAccountId ?? undefined),
        fromAccountId: isTransfer ? fromAccount.accountId : null,
        fromSubAccountId: isTransfer ? (fromAccount.subAccountId ?? null) : null,
        toAccountId: isTransfer ? toAccount.accountId : null,
        toSubAccountId: isTransfer ? (toAccount.subAccountId ?? null) : null,
        personId: personEnabled ? (personId ?? undefined) : null,
        note: note.trim() || undefined,
        relations,
        insuranceId: isTransfer || !insuranceEnabled ? null : (selectedInsuranceId ?? null),
        itemId: isTransfer || !itemEnabled ? null : (selectedItemId ?? null),
        directEnabled,
      };
      if (template) {
        return apiRequest<QuickTemplate>(
          ledgerApiPath(ledgerId, `/quick-templates/${template.id}`),
          {
            method: "PATCH",
            body,
          },
        );
      }
      return apiRequest<QuickTemplate>(ledgerApiPath(ledgerId, "/quick-templates"), {
        method: "POST",
        body,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.quickTemplates(ledgerId) });
      showToast({ tone: "success", message: isEditing ? "快速记账已更新" : "快速记账已创建" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  return (
    <form
      className="auto-transaction-sheet quick-template-sheet transaction-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="auto-transaction-sheet__header">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑快速记账" : "新建快速记账"}
        </h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存快速记账"
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="auto-transaction-sheet__body">
        <div className="transaction-form__top">
          <Tabs
            className="transaction-form__type-tabs"
            items={TYPE_ITEMS}
            onValueChange={(value) => handleTypeChange(value as TransactionType)}
            value={type}
          />
          <AmountInput
            className={cn(
              "transaction-form__amount",
              type === "income" && "transaction-form__amount--income",
            )}
            label="预设金额"
            onValueChange={setAmount}
            placeholder="留空则记账时再输入"
            value={amount}
          />
        </div>

        <div className="transaction-form__cards">
          <FieldCard className="transaction-form__note-card" label="名称">
            <div className="transaction-form__note-row">
              <span>名称</span>
              <Input
                aria-label="名称"
                label="名称"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：工作日午餐 / 咖啡"
                value={name}
              />
            </div>
          </FieldCard>

          {type !== "transfer" ? (
            <FieldCard className="transaction-form__picker-card" label="分类">
              <CategorySelectRow
                onValueChange={setCategoryId}
                options={catOptions}
                value={categoryId}
              />
            </FieldCard>
          ) : null}

          {type === "transfer" ? (
            <FieldCard className="transaction-form__picker-card" label="账户">
              <AccountSelectRow
                label="转出账户"
                onValueChange={setFromAccountId}
                options={acctOptions}
                placeholder="选择账户"
                value={fromAccountId}
              />
              <span className="transaction-form__divider" />
              <AccountSelectRow
                label="转入账户"
                onValueChange={setToAccountId}
                options={acctOptions}
                placeholder="选择账户"
                value={toAccountId}
              />
            </FieldCard>
          ) : (
            <ToggleCard
              checked={accountEnabled}
              label="账户"
              onCheckedChange={(checked) => {
                setAccountEnabled(checked);
                if (!checked) setAccountId(null);
              }}
            >
              <AccountSelectRow
                hideLabel
                label="选择账户"
                onValueChange={setAccountId}
                options={acctOptions}
                placeholder="不绑定账户"
                value={accountId}
              />
            </ToggleCard>
          )}

          <PersonSelectField
            checked={personEnabled}
            label="人员"
            onCheckedChange={(checked) => {
              setPersonEnabled(checked);
              if (!checked) setPersonId(null);
            }}
            onValueChange={setPersonId}
            options={peopleOptions}
            value={personId}
          />

          {type !== "transfer" ? (
            <>
              <RecoverablePayableEditor
                accountOptions={primaryRelationOpts}
                addLabel={`添加${primaryRelationLabel}项目`}
                emptyText={`还没有${primaryRelationLabel}项目，可到「账户」中先添加${primaryRelationLabel}账户`}
                enabled={primaryRelationsEnabled}
                hint={
                  type === "income"
                    ? "这笔收入中需要归还他人的部分"
                    : "这笔支出中可向他人收回的部分"
                }
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
                hint={
                  type === "income"
                    ? "这笔收入将自动冲减选中的可收回项目并参与计算"
                    : "这笔支出将自动冲减选中的需归还项目并参与计算"
                }
                items={linkedRelationItems}
                label={`冲减${linkedRelationLabel}项目`}
                onChange={setLinkedRelationItems}
                onEnabledChange={setLinkedRelationsEnabled}
              />

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
                onSelect={setSelectedItemId}
                selectedId={selectedItemId}
              />
            </>
          ) : null}

          <FieldCard className="transaction-form__note-card" label="备注">
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

          {/* <div className="auto-transaction-sheet__settings">
            <section className="transaction-form__card">
              <div className="transaction-form__toggle-head">
                <span>
                  <strong>一键直接记账</strong>
                  <small>开启后在账单页点闪电即可直接记账，需填写预设金额</small>
                </span>
                <Switch
                  checked={directEnabled}
                  disabled={!hasAmount}
                  label="一键直接记账"
                  onCheckedChange={setDirectEnabled}
                />
              </div>
            </section>
          </div> */}
        </div>
      </div>
    </form>
  );
}
