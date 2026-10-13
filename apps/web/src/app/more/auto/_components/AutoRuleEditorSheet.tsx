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
  NotifyTargetsRow,
  OptionPicker,
  PersonSelectField,
  RecoverablePayableEditor,
  TimeWheelPicker,
  ToggleCard,
  toggleUserId,
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
  type Subscription,
  type TransactionType,
} from "@/lib/api";
import { useNotifyCandidates } from "@/lib/data/notifications";
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
import { microsToInput, parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { insuranceTypeMeta } from "../../insurances/_components/insurance-utils";
import {
  dateOnly,
  formatDateLabel,
  REPEAT_LABELS,
  REPEAT_OPTIONS,
  resolveCategorySelection,
  ruleCategorySelection,
  todayKey,
  upcomingDates,
} from "./auto-utils";
import { localized, msg, t } from "@/lib/i18n";
import { OriginalAmountCard, useOriginalAmount } from "../../_components/OriginalAmountCard";

type AutoRuleEditorSheetProps = {
  accounts: Account[];
  categories: Category[];
  insurances: Insurance[];
  items: ItemAsset[];
  ledgerId: string;
  people: Person[];
  rule?: AutoRule;
  subscriptions: Subscription[];
};

type RelationBucket = "primary" | "linked";

const TYPE_ITEMS = localized([
  { label: msg("支出"), value: "expense" },
  { label: msg("收入"), value: "income" },
  { label: msg("转账"), value: "transfer" },
]);

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
  decimalPlaces: number,
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
      amount: microsToInput(relation.amountMicros, { decimalPlaces }),
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

/** 打开「指定时间」但未选时刻时的默认记账时间。 */
const DEFAULT_RUN_TIME = "09:00";

export function AutoRuleEditorSheet({
  accounts,
  categories,
  insurances,
  items,
  ledgerId,
  people,
  rule,
  subscriptions,
}: AutoRuleEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const [type, setType] = useState<TransactionType>(rule?.type ?? "expense");
  const [amount, setAmount] = useState(() => microsToInput(rule?.amountMicros, { decimalPlaces }));
  // 外币规则（如每月 $20 的订阅）：原币才是每期的实际金额，上面的本币金额是估算。
  const original = useOriginalAmount({
    initialCurrency: rule?.originalCurrency,
    initialMicros: rule?.originalAmountMicros,
    ledgerId,
    baseValue: amount,
    onSuggestBase: setAmount,
  });
  const [categoryId, setCategoryId] = useState<string | null>(
    rule && rule.type !== "transfer"
      ? ruleCategorySelection(rule)
      : firstCategoryId(categories, "expense"),
  );
  const initialAccountOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const [accountId, setAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.accountId, rule.subAccountId) : null,
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
    () => splitRelationBuckets(rule?.relationPayload, decimalPlaces),
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
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(Boolean(rule?.subscriptionId));
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(
    rule?.subscriptionId ?? null,
  );
  const [repeatRule, setRepeatRule] = useState<AutoRepeatRule>(rule?.repeatRule ?? "monthly");
  const [startDate, setStartDate] = useState(dateOnly(rule?.startDate) || todayKey());
  const [note, setNote] = useState(rule?.note ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [runTimeEnabled, setRunTimeEnabled] = useState(Boolean(rule?.runTime));
  const [runTime, setRunTime] = useState(rule?.runTime ?? DEFAULT_RUN_TIME);
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(
    () => rule?.notifyTargets?.map((target) => target.userId) ?? [],
  );

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
          description: `${insuredNames.length > 0 ? `${insuredNames.join(t("、"))}` : t("未指定被保人")} · ${meta.label}`,
          id: insurance.id,
          icon: meta.icon,
          name: insurance.name,
        };
      });
  }, [insurances, people]);
  const itemOptions = useMemo(
    () => items.map((item) => ({ id: item.id, icon: t("物"), name: item.name })),
    [items],
  );
  const subscriptionOptions = useMemo(
    () =>
      subscriptions
        .filter((subscription) => !subscription.terminatedAt)
        .map((subscription) => ({ id: subscription.id, icon: t("订"), name: subscription.name })),
    [subscriptions],
  );
  const nextPreview = upcomingDates(startDate, repeatRule, 1)[0] ?? startDate;

  // 可选接收人 = 本账本成员。走哪条渠道由接收人自己的通知设置决定，这里不区分。
  const candidatesQuery = useNotifyCandidates(ledgerId);
  const toggleNotifyUser = (userId: string) => {
    setNotifyUserIds((current) => toggleUserId(current, userId));
  };
  const primaryRelationLabel = type === "income" ? t("需归还") : t("可收回");
  const linkedRelationLabel = type === "income" ? t("可收回") : t("需归还");

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
      const parsed = parseMoneyToMicros(item.amount, { decimalPlaces });
      if (!parsed.ok || BigInt(parsed.amountMicros) <= 0n) throw new Error(t("关联项目金额无效"));
      const relationAccount = accounts.find((account) => account.id === item.accountId);
      const expectedKind = relationAccountKind(type, bucket);
      if (!relationAccount || relationAccount.type !== expectedKind)
        throw new Error(t("关联项目类型不正确"));
      const relationKind = relationKindFor(type, relationAccount.type);
      if (!relationKind) throw new Error(t("当前交易类型不支持关联"));
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
      const parsed = parseMoneyToMicros(amount, { decimalPlaces });
      if (!parsed.ok) throw new Error(parsed.error);
      if (BigInt(parsed.amountMicros) <= 0n) throw new Error(t("请输入有效金额"));
      const originalPayload = original.payload();
      if (!originalPayload.ok) throw new Error(originalPayload.message);
      const isTransfer = type === "transfer";
      const relations = isTransfer
        ? []
        : [
            ...buildRelations("primary", primaryRelationsEnabled, primaryRelationItems),
            ...buildRelations("linked", linkedRelationsEnabled, linkedRelationItems),
          ];
      const category = isTransfer ? {} : resolveCategorySelection(categories, categoryId);
      if (!isTransfer && !category.categoryId) throw new Error(t("请选择分类"));
      const account = isTransfer ? {} : resolveAccountSelection(accounts, accountId);
      if (!isTransfer && acctRequired && !account.accountId)
        throw new Error(t("当前账本要求绑定账户"));
      if (!isTransfer && personRequired && !personId) throw new Error(t("当前账本要求选择人员"));
      const fromAccount = isTransfer ? resolveAccountSelection(accounts, fromAccountId) : {};
      const toAccount = isTransfer ? resolveAccountSelection(accounts, toAccountId) : {};
      if (isTransfer && (!fromAccount.accountId || !toAccount.accountId)) {
        throw new Error(t("请选择转出和转入账户"));
      }
      if (
        isTransfer &&
        fromAccount.accountId === toAccount.accountId &&
        (fromAccount.subAccountId ?? null) === (toAccount.subAccountId ?? null)
      ) {
        throw new Error(t("转出和转入不能是同一账户"));
      }
      const body = {
        type,
        amountMicros: parsed.amountMicros,
        originalCurrency: originalPayload.originalCurrency,
        originalAmountMicros: originalPayload.originalAmountMicros,
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
        subscriptionId:
          isTransfer || !subscriptionEnabled ? null : (selectedSubscriptionId ?? null),
        repeatRule,
        startDate,
        // 关掉指定时间时一并清空接收人：后端也会兜底，显式传更省得靠「后端记得清」。
        runTime: runTimeEnabled ? runTime || DEFAULT_RUN_TIME : null,
        notifyUserIds: runTimeEnabled ? notifyUserIds : [],
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
      showToast({
        tone: "success",
        message: isEditing ? t("自动记账已更新") : t("自动记账已创建"),
      });
      pop();
    },
  });

  const parsedAmount = parseMoneyToMicros(amount, { decimalPlaces });
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
          <FieldCard className="transaction-form__picker-card" key="category" label={t("分类")}>
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
            <FieldCard className="transaction-form__picker-card" key="account" label={t("账户")}>
              <AccountSelectRow
                label={t("转出账户")}
                onValueChange={setFromAccountId}
                options={acctOptions}
                value={fromAccountId}
              />
              <span className="transaction-form__divider" />
              <AccountSelectRow
                label={t("转入账户")}
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
            label={t("账户")}
            onCheckedChange={(checked) => {
              setAccountId(checked ? firstSelectableAccountOptionId(acctOptions) : null);
            }}
          >
            <AccountSelectRow
              hideLabel
              label={t("选择账户")}
              onValueChange={setAccountId}
              options={acctOptions}
              placeholder={t("不绑定账户")}
              value={accountId}
            />
          </ToggleCard>
        );
      case "date":
        return (
          <FieldCard className="transaction-form__date-card" key="date" label={t("日期")}>
            <DateWheelPicker label={t("起始日期")} onValueChange={setStartDate} value={startDate} />
          </FieldCard>
        );
      case "person":
        return (
          <PersonSelectField
            checked={personEnabled}
            disabled={personRequired}
            key="person"
            label={t("人员")}
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
          <FieldCard className="transaction-form__note-card" key="note" label={t("备注")}>
            <div className="transaction-form__note-row">
              <span>{t("备注")}</span>
              <Input
                aria-label={t("备注")}
                label={t("备注")}
                maxLength={240}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("如：房租 / 视频会员...")}
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
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? t("编辑自动记账") : t("新建自动记账")}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={t("保存自动记账")}
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
            decimalPlaces={decimalPlaces}
            label={original.foreign ? t("每期金额（本币估算）") : t("每期金额")}
            onValueChange={setAmount}
            value={amount}
          />
        </div>

        <div className="transaction-form__cards">
          <OriginalAmountCard state={original} />
          {orderedFieldsForType(order, type).map(renderField)}

          {type !== "transfer" ? (
            <>
              <RecoverablePayableEditor
                accountOptions={primaryRelationOpts}
                addLabel={t("添加{primaryRelationLabel}项目", { primaryRelationLabel })}
                emptyText={t(
                  "还没有{primaryRelationLabel}项目，可到「账户」中先添加{primaryRelationLabel2}账户",
                  { primaryRelationLabel, primaryRelationLabel2: primaryRelationLabel },
                )}
                enabled={primaryRelationsEnabled}
                hint={
                  type === "income"
                    ? t("这笔收入中需要归还他人的部分")
                    : t("这笔支出中可向他人收回的部分")
                }
                items={primaryRelationItems}
                label={primaryRelationLabel}
                onChange={setPrimaryRelationItems}
                onEnabledChange={setPrimaryRelationsEnabled}
              />

              <RecoverablePayableEditor
                accountOptions={linkedRelationOpts}
                addLabel={t("添加{linkedRelationLabel}项目", { linkedRelationLabel })}
                emptyText={t(
                  "还没有{linkedRelationLabel}项目，可到「账户」中先添加{linkedRelationLabel2}账户",
                  { linkedRelationLabel, linkedRelationLabel2: linkedRelationLabel },
                )}
                enabled={linkedRelationsEnabled}
                hint={
                  type === "income"
                    ? t("这笔收入将自动冲减选中的可收回项目并参与计算")
                    : t("这笔支出将自动冲减选中的需归还项目并参与计算")
                }
                items={linkedRelationItems}
                label={t("冲减{linkedRelationLabel}项目", { linkedRelationLabel })}
                onChange={setLinkedRelationItems}
                onEnabledChange={setLinkedRelationsEnabled}
              />

              <AssetLinkCard
                checked={insuranceEnabled}
                emptyText={t("还没有保单，可到「我的 · 保险管理」中先添加保单")}
                hint={
                  type === "income"
                    ? t("把这笔收入（如理赔款）关联到一份保单")
                    : t("把这笔支出（如保费）关联到一份保单")
                }
                items={insuranceOptions}
                label={t("保险")}
                onCheckedChange={(checked) => {
                  setInsuranceEnabled(checked);
                  if (!checked) setSelectedInsuranceId(null);
                }}
                onSelect={setSelectedInsuranceId}
                selectedId={selectedInsuranceId}
              />

              <AssetLinkCard
                checked={itemEnabled}
                emptyText={t("还没有物品，可到「我的 · 物品管理」中先添加物品")}
                hint={
                  type === "income"
                    ? t("把这笔收入（如转卖回款）关联到一件物品")
                    : t("把这笔支出（如耗材、维修）关联到一件物品")
                }
                items={itemOptions}
                label={t("关联物品")}
                onCheckedChange={(checked) => {
                  setItemEnabled(checked);
                  if (!checked) setSelectedItemId(null);
                }}
                onSelect={setSelectedItemId}
                selectedId={selectedItemId}
              />

              <AssetLinkCard
                checked={subscriptionEnabled}
                emptyText={t("还没有订阅，可到「我的 · 订阅管理」中先添加订阅")}
                hint={
                  type === "income"
                    ? t("把这笔收入（如退款）关联到一个订阅")
                    : t("把这笔支出（如订阅费）关联到一个订阅")
                }
                items={subscriptionOptions}
                label={t("关联订阅")}
                onCheckedChange={(checked) => {
                  setSubscriptionEnabled(checked);
                  if (!checked) setSelectedSubscriptionId(null);
                }}
                onSelect={setSelectedSubscriptionId}
                selectedId={selectedSubscriptionId}
              />
            </>
          ) : null}

          <div className="auto-transaction-sheet__settings">
            <FieldCard className="transaction-form__picker-card" label={t("自动设置")}>
              <OptionPicker
                label={t("重复周期")}
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

            <ToggleCard
              checked={runTimeEnabled}
              hint={t("到点再生成待确认，并推送提醒")}
              label={t("指定时间")}
              onCheckedChange={setRunTimeEnabled}
            >
              <div className="transaction-form__date-card">
                <TimeWheelPicker label={t("记账时间")} onValueChange={setRunTime} value={runTime} />
              </div>
              <div className="transaction-form__card transaction-form__picker-card">
                <NotifyTargetsRow
                  candidates={candidatesQuery.data ?? []}
                  loading={candidatesQuery.isLoading}
                  onToggle={toggleNotifyUser}
                  values={notifyUserIds}
                />
              </div>
            </ToggleCard>

            <section className="transaction-form__card">
              <div className="transaction-form__toggle-head">
                <span>
                  <strong>{t("启用")}</strong>
                  <small>
                    {t("下次自动生成：{value} · {value2}", {
                      value: enabled ? formatDateLabel(nextPreview) : t("暂停中"),
                      value2: REPEAT_LABELS[repeatRule],
                    })}
                  </small>
                </span>
                <Switch checked={enabled} label={t("启用")} onCheckedChange={setEnabled} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </form>
  );
}
