"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import {
  AccountSelectRow,
  AmountInput,
  CategorySelectRow,
  DateWheelPicker,
  FieldCard,
  ToggleCard,
} from "@/components/business";
import { ActionButton, Input, SelectField, Switch, Tabs } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AutoRepeatRule,
  type AutoRule,
  type Category,
  type Person,
  type TransactionType,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import {
  accountSelectionId,
  categoryOptions,
  moneyAccountOptions,
  personOptions,
  resolveAccountSelection,
} from "@/lib/data/options";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
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
  ledgerId: string;
  people: Person[];
  rule?: AutoRule;
};

const TYPE_ITEMS = [
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
  { label: "转账", value: "transfer" },
];

function firstCategoryId(categories: Category[], type: "expense" | "income"): string | null {
  const first = categories.find((category) => category.type === type);
  return first?.subcategories.find((subcategory) => !subcategory.archivedAt)?.id ?? first?.id ?? null;
}

function categoryType(type: TransactionType): "expense" | "income" {
  return type === "income" ? "income" : "expense";
}

export function AutoRuleEditorSheet({
  accounts,
  categories,
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
    rule && rule.type !== "transfer" ? ruleCategorySelection(rule) : firstCategoryId(categories, "expense"),
  );
  const [accountId, setAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.accountId, rule.subAccountId) : (moneyAccountOptions(accounts)[0]?.id ?? null),
  );
  const [fromAccountId, setFromAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.fromAccountId, rule.fromSubAccountId) : null,
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    rule ? accountSelectionId(rule.toAccountId, rule.toSubAccountId) : null,
  );
  const [personEnabled, setPersonEnabled] = useState(Boolean(rule?.personId));
  const [personId, setPersonId] = useState<string | null>(rule?.personId ?? null);
  const [repeatRule, setRepeatRule] = useState<AutoRepeatRule>(rule?.repeatRule ?? "monthly");
  const [startDate, setStartDate] = useState(dateOnly(rule?.startDate) || todayKey());
  const [note, setNote] = useState(rule?.note ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const isEditing = Boolean(rule);
  const catOptions = useMemo(() => categoryOptions(categories, categoryType(type)), [categories, type]);
  const acctOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const peopleOptions = useMemo(() => personOptions(people), [people]);
  const nextPreview = upcomingDates(startDate, repeatRule, 1)[0] ?? startDate;

  useEffect(() => {
    if (type === "transfer") return;
    const resolved = resolveCategorySelection(categories, categoryId);
    const selectedCategory = categories.find((category) => category.id === resolved.categoryId);
    if (selectedCategory?.type !== type) {
      setCategoryId(firstCategoryId(categories, type));
    }
  }, [categories, categoryId, type]);

  function handleTypeChange(nextType: TransactionType) {
    if (nextType === type) return;
    setType(nextType);
    if (nextType === "transfer") {
      setPersonEnabled(false);
      setPersonId(null);
      return;
    }
    setCategoryId(firstCategoryId(categories, nextType));
  }

  const save = useMutation({
    mutationFn: () => {
      const parsed = parseMoneyToMicros(amount);
      if (!parsed.ok) throw new Error(parsed.error);
      if (BigInt(parsed.amountMicros) <= 0n) throw new Error("请输入有效金额");
      const isTransfer = type === "transfer";
      const category = isTransfer ? {} : resolveCategorySelection(categories, categoryId);
      if (!isTransfer && !category.categoryId) throw new Error("请选择分类");
      const account = isTransfer ? {} : resolveAccountSelection(accounts, accountId);
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
        personId: isTransfer || !personEnabled ? null : (personId ?? null),
        note: note.trim(),
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
  const canSubmit =
    parsedAmount.ok &&
    BigInt(parsedAmount.amountMicros) > 0n &&
    (type === "transfer" ? transferReady : Boolean(resolveCategorySelection(categories, categoryId).categoryId)) &&
    !save.isPending;

  return (
    <form
      className="auto-transaction-sheet transaction-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) save.mutate();
      }}
    >
      <div className="auto-transaction-sheet__header">
        <ActionButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑自动记账" : "新建自动记账"}
        </h2>
        <ActionButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存自动记账"
          tone="primary"
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
            className={cn("transaction-form__amount", type === "income" && "transaction-form__amount--income")}
            label="每期金额"
            onValueChange={setAmount}
            value={amount}
          />
        </div>

        <div className="transaction-form__cards">
          {type !== "transfer" ? (
            <FieldCard className="transaction-form__picker-card" label="分类">
              <CategorySelectRow onValueChange={setCategoryId} options={catOptions} value={categoryId} />
            </FieldCard>
          ) : null}

          {type === "transfer" ? (
            <FieldCard className="transaction-form__picker-card" label="账户">
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
          ) : (
            <ToggleCard
              checked={Boolean(accountId)}
              label="账户"
              onCheckedChange={(checked) => {
                setAccountId(checked ? (acctOptions[0]?.id ?? null) : null);
              }}
            >
              <AccountSelectRow
                allowClear
                hideLabel
                label="选择账户"
                onValueChange={setAccountId}
                options={acctOptions}
                placeholder="不绑定账户"
                value={accountId}
              />
            </ToggleCard>
          )}

          <FieldCard className="transaction-form__date-card" label="日期">
            <DateWheelPicker label="起始日期" onValueChange={setStartDate} value={startDate} />
          </FieldCard>

          {type !== "transfer" ? (
            <ToggleCard
              checked={personEnabled}
              label="人员"
              onCheckedChange={(checked) => {
                setPersonEnabled(checked);
                if (!checked) setPersonId(null);
              }}
            >
              {peopleOptions.length > 0 ? (
                <div className="transaction-form__people-row">
                  {peopleOptions.map((person) => {
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
              ) : (
                <p className="transaction-form__empty-text">还没有人员，可到人员管理中添加</p>
              )}
            </ToggleCard>
          ) : null}

          <FieldCard className="transaction-form__note-card" label="备注">
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

          <div className="auto-transaction-sheet__settings">
            <FieldCard className="transaction-form__picker-card" label="自动设置">
              <SelectField
                label="重复周期"
                menuWidth="trigger"
                onValueChange={(value) => setRepeatRule(value as AutoRepeatRule)}
                options={REPEAT_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
                value={repeatRule}
              />
            </FieldCard>

            <section className="transaction-form__card">
              <div className="transaction-form__toggle-head">
                <span>
                  <strong>启用</strong>
                  <small>
                    下次自动生成：{enabled ? formatDateLabel(nextPreview) : "暂停中"} · {REPEAT_LABELS[repeatRule]}
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
