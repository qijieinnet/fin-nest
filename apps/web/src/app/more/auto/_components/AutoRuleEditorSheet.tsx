"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import {
  AccountSelectRow,
  AmountInput,
  AssetLinkCard,
  CategorySelectRow,
  DateWheelPicker,
  FieldCard,
  OptionPicker,
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
  type AutoRepeatRule,
  type AutoRule,
  type Category,
  type Insurance,
  type ItemAsset,
  type Person,
  type TransactionType,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import {
  accountSelectionId,
  categoryOptions,
  firstSelectableAccountOptionId,
  moneyAccountOptions,
  personOptions,
  relationAccountOptions,
  relationKindFor,
  resolveAccountSelection,
} from "@/lib/data/options";
import { effectiveFieldOrder, orderedFieldsForType } from "@/lib/data/field-order";
import { useRecordSetting } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { insuranceTypeMeta } from "../../insurances/_components/insurance-utils";
import {
  dateOnly,
  formatDateLabel,
  microsToInput,
  REPEAT_LABELS,
  REPEAT_OPTIONS,
  resolveCategorySelection,
  ruleCategorySelection,
  todayKey,
  upcomingDates,
} from "./auto-utils";

type AutoRuleEditorSheetProps = {
  accounts: Account[];
  categories: Category[];
  insurances: Insurance[];
  items: ItemAsset[];
  ledgerId: string;
  people: Person[];
  rule?: AutoRule;
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

/** 把规则里已存的关联拆回「主项目 / 联动项目」两个编辑桶。 */
function splitRelationBuckets(
  relations: AutoRelation[] | null | undefined,
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
      amount: microsToInput(relation.amountMicros),
    });
  }
  return buckets;
}

function firstCategoryId(categories: Category[], type: "expense" | "income"): string | null {
  const first = categories.find((category) => category.type === type);
  return (
    first?.subcategories.find((subcategory) => !subcategory.archivedAt)?.id ?? first?.id ?? null
  );
}

function categoryType(type: TransactionType): "expense" | "income" {
  return type === "income" ? "income" : "expense";
}

export function AutoRuleEditorSheet({
  accounts,
  categories,
  insurances,
  items,
  ledgerId,
  people,
  rule,
}: AutoRuleEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [type, setType] = useState<TransactionType>(rule?.type ?? "expense");
  const [amount, setAmount] = useState(() => microsToInput(rule?.amountMicros));
  const [categoryId, setCategoryId] = useState<string | null>(
    rule && rule.type !== "transfer"
      ? ruleCategorySelection(rule)
      : firstCategoryId(categories, "expense"),
  );
  const initialAccountOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const [accountId, setAccountId] = useState<string | null>(
    rule
      ? accountSelectionId(rule.accountId, rule.subAccountId)
      : firstSelectableAccountOptionId(initialAccountOptions),
  );
  const [fromAccountId, setFromAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.fromAccountId, rule.fromSubAccountId) : null,
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.toAccountId, rule.toSubAccountId) : null,
  );
  const [personEnabled, setPersonEnabled] = useState(Boolean(rule?.personId));
  const [personId, setPersonId] = useState<string | null>(rule?.personId ?? null);
  const initialBuckets = useMemo(
    () => splitRelationBuckets(rule?.relationPayload),
    [rule?.relationPayload],
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
  const [insuranceEnabled, setInsuranceEnabled] = useState(Boolean(rule?.insuranceId));
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(
    rule?.insuranceId ?? null,
  );
  const [itemEnabled, setItemEnabled] = useState(Boolean(rule?.itemId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(rule?.itemId ?? null);
  const [repeatRule, setRepeatRule] = useState<AutoRepeatRule>(rule?.repeatRule ?? "monthly");
  const [startDate, setStartDate] = useState(dateOnly(rule?.startDate) || todayKey());
  const [note, setNote] = useState(rule?.note ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const isEditing = Boolean(rule);
  const catOptions = useMemo(
    () => categoryOptions(categories, categoryType(type)),
    [categories, type],
  );
  const acctOptions = initialAccountOptions;
  const peopleOptions = useMemo(() => personOptions(people), [people]);
  const primaryRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "primary")),
    [accounts, type],
  );
  const linkedRelationOpts = useMemo(
    () => relationAccountOptions(accounts, relationAccountKind(type, "linked")),
    [accounts, type],
  );
  const insuranceOptions = useMemo(() => {
    const personById = new Map(people.map((person) => [person.id, person.name]));
    return insurances
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
  }, [insurances, people]);
  const itemOptions = useMemo(
    () => items.map((item) => ({ id: item.id, icon: "物", name: item.name })),
    [items],
  );
  const nextPreview = upcomingDates(startDate, repeatRule, 1)[0] ?? startDate;
  const primaryRelationLabel = type === "income" ? "需归还" : "可收回";
  const linkedRelationLabel = type === "income" ? "可收回" : "需归还";

  const setting = useRecordSetting(ledgerId).data;
  const order = effectiveFieldOrder(setting);
  const acctRequired = setting?.acctRequired ?? false;
  const personRequired = setting?.personRequired ?? false;

  // 账户 / 人员被记账设置标记为必填时，强制开启并回填一个默认值（与「记一笔」一致）。
  useEffect(() => {
    if (type !== "transfer" && acctRequired && !accountId) {
      setAccountId(firstSelectableAccountOptionId(acctOptions));
    }
    if (personRequired) {
      setPersonEnabled(true);
      if (!personId && peopleOptions[0]?.id) setPersonId(peopleOptions[0].id);
    }
  }, [acctRequired, accountId, acctOptions, peopleOptions, personId, personRequired, type]);

  useEffect(() => {
    if (type === "transfer") return;
    const resolved = resolveCategorySelection(categories, categoryId);
    const selectedCategory = categories.find((category) => category.id === resolved.categoryId);
    if (selectedCategory?.type !== type) {
      setCategoryId(firstCategoryId(categories, type));
    }
  }, [categories, categoryId, type]);

  function resetRelations() {
    setPrimaryRelationItems([]);
    setLinkedRelationItems([]);
    setPrimaryRelationsEnabled(false);
    setLinkedRelationsEnabled(false);
  }

  function handleTypeChange(nextType: TransactionType) {
    if (nextType === type) return;
    setType(nextType);
    // 关联类型随收支方向变化，切换类型时需要清空，避免残留不匹配的关联。
    resetRelations();
    if (nextType === "transfer") {
      setInsuranceEnabled(false);
      setSelectedInsuranceId(null);
      setItemEnabled(false);
      setSelectedItemId(null);
      return;
    }
    setCategoryId(firstCategoryId(categories, nextType));
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

  const save = useMutation({
    mutationFn: () => {
      const parsed = parseMoneyToMicros(amount);
      if (!parsed.ok) throw new Error(parsed.error);
      if (BigInt(parsed.amountMicros) <= 0n) throw new Error("请输入有效金额");
      const isTransfer = type === "transfer";
      const relations = isTransfer
        ? []
        : [
            ...buildRelations("primary", primaryRelationsEnabled, primaryRelationItems),
            ...buildRelations("linked", linkedRelationsEnabled, linkedRelationItems),
          ];
      const category = isTransfer ? {} : resolveCategorySelection(categories, categoryId);
      if (!isTransfer && !category.categoryId) throw new Error("请选择分类");
      const account = isTransfer ? {} : resolveAccountSelection(accounts, accountId);
      if (!isTransfer && acctRequired && !account.accountId)
        throw new Error("当前账本要求绑定账户");
      if (!isTransfer && personRequired && !personId) throw new Error("当前账本要求选择人员");
      const fromAccount = isTransfer ? resolveAccountSelection(accounts, fromAccountId) : {};
      const toAccount = isTransfer ? resolveAccountSelection(accounts, toAccountId) : {};
      if (isTransfer && (!fromAccount.accountId || !toAccount.accountId)) {
        throw new Error("请选择转出和转入账户");
      }
      if (
        isTransfer &&
        fromAccount.accountId === toAccount.accountId &&
        (fromAccount.subAccountId ?? null) === (toAccount.subAccountId ?? null)
      ) {
        throw new Error("转出和转入不能是同一账户");
      }
      const body = {
        type,
        amountMicros: parsed.amountMicros,
        categoryId: isTransfer ? null : category.categoryId,
        subcategoryId: isTransfer ? null : (category.subcategoryId ?? null),
        accountId: isTransfer ? null : (account.accountId ?? null),
        subAccountId: isTransfer ? null : (account.subAccountId ?? null),
        fromAccountId: isTransfer ? fromAccount.accountId : null,
        fromSubAccountId: isTransfer ? (fromAccount.subAccountId ?? null) : null,
        toAccountId: isTransfer ? toAccount.accountId : null,
        toSubAccountId: isTransfer ? (toAccount.subAccountId ?? null) : null,
        personId: personEnabled ? (personId ?? null) : null,
        note: note.trim(),
        relations,
        insuranceId: isTransfer || !insuranceEnabled ? null : (selectedInsuranceId ?? null),
        itemId: isTransfer || !itemEnabled ? null : (selectedItemId ?? null),
        repeatRule,
        startDate,
        enabled,
      };
      if (rule) {
        return apiRequest<AutoRule>(ledgerApiPath(ledgerId, `/auto-rules/${rule.id}`), {
          method: "PATCH",
          body,
        });
      }
      return apiRequest<AutoRule>(ledgerApiPath(ledgerId, "/auto-rules"), { method: "POST", body });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.autoRules(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
      ]);
      showToast({ tone: "success", message: isEditing ? "自动记账已更新" : "自动记账已创建" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const parsedAmount = parseMoneyToMicros(amount);
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
  const accountReady =
    !acctRequired || Boolean(resolveAccountSelection(accounts, accountId).accountId);
  const personReady = !personRequired || Boolean(personId);
  const canSubmit =
    parsedAmount.ok &&
    BigInt(parsedAmount.amountMicros) > 0n &&
    (type === "transfer"
      ? transferReady
      : Boolean(resolveCategorySelection(categories, categoryId).categoryId) &&
        accountReady &&
        personReady) &&
    !save.isPending;

  const renderField = (field: string) => {
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
                onValueChange={setFromAccountId}
                options={acctOptions}
                value={fromAccountId}
              />
              <span className="transaction-form__divider" />
              <AccountSelectRow
                label="转入账户"
                onValueChange={setToAccountId}
                options={acctOptions}
                value={toAccountId}
              />
            </FieldCard>
          );
        }
        return (
          <ToggleCard
            checked={Boolean(accountId)}
            disabled={acctRequired}
            key="account"
            label="账户"
            onCheckedChange={(checked) => {
              setAccountId(checked ? firstSelectableAccountOptionId(acctOptions) : null);
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
        );
      case "date":
        return (
          <FieldCard className="transaction-form__date-card" key="date" label="日期">
            <DateWheelPicker label="起始日期" onValueChange={setStartDate} value={startDate} />
          </FieldCard>
        );
      case "person":
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
            options={peopleOptions}
            value={personId}
          />
        );
      case "note":
        return (
          <FieldCard className="transaction-form__note-card" key="note" label="备注">
            <div className="transaction-form__note-row">
              <span>备注</span>
              <Input
                aria-label="备注"
                label="备注"
                maxLength={240}
                onChange={(event) => setNote(event.target.value)}
                placeholder="如：房租 / 视频会员..."
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
    <form
      className="auto-transaction-sheet transaction-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) save.mutate();
      }}
    >
      <div className="auto-transaction-sheet__header">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑自动记账" : "新建自动记账"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存自动记账"
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
            label="每期金额"
            onValueChange={setAmount}
            value={amount}
          />
        </div>

        <div className="transaction-form__cards">
          {orderedFieldsForType(order, type).map(renderField)}

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

          <div className="auto-transaction-sheet__settings">
            <FieldCard className="transaction-form__picker-card" label="自动设置">
              <OptionPicker
                label="重复周期"
                onValueChange={(value) => {
                  if (value) setRepeatRule(value as AutoRepeatRule);
                }}
                options={REPEAT_OPTIONS.map((option) => ({
                  id: option.value,
                  label: option.label,
                }))}
                value={repeatRule}
              />
            </FieldCard>

            <section className="transaction-form__card">
              <div className="transaction-form__toggle-head">
                <span>
                  <strong>启用</strong>
                  <small>
                    下次自动生成：{enabled ? formatDateLabel(nextPreview) : "暂停中"} ·{" "}
                    {REPEAT_LABELS[repeatRule]}
                  </small>
                </span>
                <Switch checked={enabled} label="启用" onCheckedChange={setEnabled} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </form>
  );
}
