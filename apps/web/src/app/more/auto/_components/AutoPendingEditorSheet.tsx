"use client";

import { useMemo, useState } from "react";
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
import { IconButton, Input } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AutoPendingTransaction,
  type Category,
  type Person,
} from "@/lib/api";
import {
  accountSelectionId,
  categoryOptions,
  firstSelectableAccountOptionId,
  moneyAccountOptions,
  personOptions,
  resolveAccountSelection,
} from "@/lib/data/options";
import { cn } from "@/lib/format/class-names";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { dateOnly, microsToInput, resolveCategorySelection } from "./auto-utils";

type AutoPendingEditorSheetProps = {
  accounts: Account[];
  categories: Category[];
  ledgerId: string;
  pending: AutoPendingTransaction;
  people: Person[];
};

export function AutoPendingEditorSheet({
  accounts,
  categories,
  ledgerId,
  pending,
  people,
}: AutoPendingEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [amount, setAmount] = useState(() => microsToInput(pending.amountMicros));
  const [scheduledFor, setScheduledFor] = useState(dateOnly(pending.scheduledFor));
  const [categoryId, setCategoryId] = useState<string | null>(
    pending.subcategoryId ?? pending.categoryId,
  );
  const [accountId, setAccountId] = useState<string | null>(
    accountSelectionId(pending.accountId, pending.subAccountId),
  );
  const [fromAccountId, setFromAccountId] = useState<string | null>(
    accountSelectionId(pending.fromAccountId, pending.fromSubAccountId),
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    accountSelectionId(pending.toAccountId, pending.toSubAccountId),
  );
  const [personEnabled, setPersonEnabled] = useState(Boolean(pending.personId));
  const [personId, setPersonId] = useState<string | null>(pending.personId);
  const [note, setNote] = useState(pending.note ?? "");

  const catOptions = useMemo(
    () => categoryOptions(categories, pending.type === "income" ? "income" : "expense"),
    [categories, pending.type],
  );
  const acctOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const peopleOptions = useMemo(() => personOptions(people), [people]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = parseMoneyToMicros(amount);
      if (!parsed.ok) throw new Error(parsed.error);
      if (BigInt(parsed.amountMicros) <= 0n) throw new Error("请输入有效金额");
      const isTransfer = pending.type === "transfer";
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
      return apiRequest<AutoPendingTransaction>(
        ledgerApiPath(ledgerId, `/auto-pending-transactions/${pending.id}`),
        {
          method: "PATCH",
          body: {
            amountMicros: parsed.amountMicros,
            scheduledFor,
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
          },
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.autoPending(ledgerId) });
      showToast({ tone: "success", message: "待确认记录已更新" });
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
    pending.type === "transfer" &&
    Boolean(fromAccount.accountId) &&
    Boolean(toAccount.accountId) &&
    !(
      fromAccount.accountId === toAccount.accountId &&
      (fromAccount.subAccountId ?? null) === (toAccount.subAccountId ?? null)
    );
  const canSubmit =
    parsedAmount.ok &&
    BigInt(parsedAmount.amountMicros) > 0n &&
    (pending.type === "transfer"
      ? transferReady
      : Boolean(resolveCategorySelection(categories, categoryId).categoryId)) &&
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
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          编辑待确认
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存待确认记录"
          variant="primary"
          type="submit"
        />
      </div>

      <div className="auto-transaction-sheet__body">
        <div className="transaction-form__top">
          <AmountInput
            className={cn(
              "transaction-form__amount",
              pending.type === "income" && "transaction-form__amount--income",
            )}
            label="金额"
            onValueChange={setAmount}
            value={amount}
          />
        </div>

        <div className="transaction-form__cards">
          {pending.type !== "transfer" ? (
            <FieldCard className="transaction-form__picker-card" label="分类">
              <CategorySelectRow
                onValueChange={setCategoryId}
                options={catOptions}
                value={categoryId}
              />
            </FieldCard>
          ) : null}

          {pending.type === "transfer" ? (
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
          )}

          <FieldCard className="transaction-form__date-card" label="日期">
            <DateWheelPicker
              label="记账日期"
              onValueChange={setScheduledFor}
              value={scheduledFor}
            />
          </FieldCard>

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
                      className={cn(
                        "transaction-form__chip",
                        selected && "transaction-form__chip--selected",
                      )}
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

          <FieldCard className="transaction-form__note-card" label="备注">
            <div className="transaction-form__note-row">
              <span>备注</span>
              <Input
                aria-label="备注"
                label="备注"
                maxLength={240}
                onChange={(event) => setNote(event.target.value)}
                placeholder="选填..."
                value={note}
              />
            </div>
          </FieldCard>
        </div>
      </div>
    </form>
  );
}
