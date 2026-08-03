"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { DateWheelPicker, InlineHint } from "@/components/business";
import { EmojiPicker, IconButton, PopoverMenu } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AccountType,
  type SubAccount,
} from "@/lib/api";
import { createClientId } from "@/lib/id/client-id";
import { microsToInput, parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { ACCOUNT_GROUPS } from "./account-utils";

type AccountEditorSheetProps = {
  account?: Account;
  ledgerId: string;
  parentAccount?: Account;
  subAccount?: SubAccount;
};

function parseOptionalDay(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const day = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`${label}需为 1-31 的整数`);
  return day;
}

function FieldRow({
  inputMode,
  label,
  maxLength,
  onChange,
  placeholder,
  prefix,
  value,
}: {
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  prefix?: string;
  value: string;
}) {
  return (
    <label className="account-form__field-row">
      <span>{label}</span>
      <span className="account-form__input-wrap">
        {prefix ? <span className="account-form__prefix">{prefix}</span> : null}
        <input
          className="account-form__input"
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={onChange}
          placeholder={placeholder}
          value={value}
        />
      </span>
    </label>
  );
}

function DaySelectRow({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1));

  const toggleOpen = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      setDropUp(below < 360 && above > below);
    }
    setOpen((current) => !current);
  };

  return (
    <div className="relative">
      <button
        className="account-form__select-row"
        onClick={toggleOpen}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        <strong>{value ? `每月 ${value} 日` : "未设置"}</strong>
        <ChevronRight size={18} />
      </button>
      <PopoverMenu
        groups={[
          [
            {
              label: "不设置",
              onSelect: () => onChange(""),
              selected: !value,
            },
          ],
          dayOptions.map((day) => ({
            label: `每月 ${day} 日`,
            onSelect: () => onChange(day),
            selected: value === day,
          })),
        ]}
        className={`account-form__day-menu ${
          dropUp ? "account-form__day-menu--up" : "account-form__day-menu--down"
        }`}
        onOpenChange={setOpen}
        open={open}
      />
    </div>
  );
}

function OptionalDateCard({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (value) {
    return (
      <div className="transaction-form__card transaction-form__date-card">
        <DateWheelPicker label={label} onValueChange={onChange} value={value} />
      </div>
    );
  }

  return (
    <button
      className="transaction-form__row-card"
      onClick={() => {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        onChange(`${now.getFullYear()}-${month}-${day}`);
      }}
      type="button"
    >
      <span>{label}</span>
      <strong>未设置</strong>
      <ChevronRight size={18} />
    </button>
  );
}

export function AccountEditorSheet({
  account,
  ledgerId,
  parentAccount,
  subAccount,
}: AccountEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const isSubAccountMode = Boolean(parentAccount);
  const isEditing = Boolean(account || subAccount);

  const [type, setType] = useState<AccountType>(account?.type ?? "savings");
  const [name, setName] = useState(subAccount?.name ?? account?.name ?? "");
  const [icon, setIcon] = useState(subAccount?.icon ?? account?.icon ?? "💵");
  const [balance, setBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState(() => microsToInput(account?.creditLimitMicros, { decimalPlaces }));
  const [investCost, setInvestCost] = useState(() => microsToInput(account?.investmentCostMicros, { decimalPlaces }));
  const [counterparty, setCounterparty] = useState(account?.counterparty ?? "");
  const [dueDate, setDueDate] = useState(account?.dueDate?.slice(0, 10) ?? "");
  const [billDay, setBillDay] = useState(account?.billDay ? String(account.billDay) : "");
  const [repayDay, setRepayDay] = useState(account?.repayDay ? String(account.repayDay) : "");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;
  const title = isSubAccountMode
    ? subAccount
      ? "编辑子账户"
      : "添加子账户"
    : isEditing
      ? "编辑账户"
      : "新建账户";

  const save = useMutation({
    mutationFn: async () => {
      if (parentAccount) {
        const shared = { name: trimmedName, icon };
        if (subAccount) {
          return apiRequest<SubAccount>(
            ledgerApiPath(ledgerId, `/accounts/${parentAccount.id}/sub-accounts/${subAccount.id}`),
            { method: "PATCH", body: shared },
          );
        }
        const balanceParsed = balance.trim()
          ? parseMoneyToMicros(balance, { allowNegative: true, decimalPlaces })
          : null;
        if (balanceParsed && !balanceParsed.ok) throw new Error("余额格式不正确");
        return apiRequest<SubAccount>(
          ledgerApiPath(ledgerId, `/accounts/${parentAccount.id}/sub-accounts`),
          {
            method: "POST",
            body: { ...shared, balanceMicros: balanceParsed?.amountMicros },
            headers: { "idempotency-key": createClientId("sub-account") },
          },
        );
      }

      const limitParsed = creditLimit.trim() ? parseMoneyToMicros(creditLimit, { decimalPlaces }) : null;
      if (limitParsed && !limitParsed.ok) throw new Error("信用额度格式不正确");
      const costParsed = investCost.trim() ? parseMoneyToMicros(investCost, { decimalPlaces }) : null;
      if (costParsed && !costParsed.ok) throw new Error("投入本金格式不正确");
      const billDayValue = parseOptionalDay(billDay, "账单日");
      const repayDayValue = parseOptionalDay(repayDay, "还款日");

      const shared = {
        name: trimmedName,
        icon,
        creditLimitMicros: type === "credit" ? limitParsed?.amountMicros : undefined,
        investmentCostMicros: type === "invest" ? costParsed?.amountMicros : undefined,
        counterparty:
          type === "receivable" || type === "payable"
            ? counterparty.trim() || undefined
            : undefined,
        dueDate: type === "receivable" || type === "payable" ? dueDate || undefined : undefined,
        billDay: type === "credit" ? billDayValue : undefined,
        repayDay: type === "credit" ? repayDayValue : undefined,
      };

      if (account) {
        return apiRequest<Account>(ledgerApiPath(ledgerId, `/accounts/${account.id}`), {
          method: "PATCH",
          body: shared,
        });
      }

      const balanceParsed = balance.trim()
        ? parseMoneyToMicros(balance, { allowNegative: true })
        : null;
      if (balanceParsed && !balanceParsed.ok) throw new Error("余额格式不正确");
      return apiRequest<Account>(ledgerApiPath(ledgerId, "/accounts"), {
        method: "POST",
        body: { ...shared, type, balanceMicros: balanceParsed?.amountMicros },
        headers: { "idempotency-key": createClientId("account") },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
        parentAccount
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.accountEntries(ledgerId, parentAccount.id),
            })
          : Promise.resolve(),
      ]);
      showToast({
        tone: "success",
        message: isSubAccountMode
          ? isEditing
            ? "子账户已更新"
            : "子账户已添加"
          : isEditing
            ? "账户已更新"
            : "账户已添加",
      });
      pop();
    },
  });

  const isLend = type === "receivable" || type === "payable";
  const typeOptions = ACCOUNT_GROUPS.map((group) => ({
    id: group.key,
    label: group.name,
    disabled: isEditing && group.key !== type,
  }));
  const selectedTypeName =
    ACCOUNT_GROUPS.find((group) => group.key === type)?.name ?? "选择账户类型";

  return (
    <form
      className="transaction-form flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={isSubAccountMode ? "保存子账户" : "保存账户"}
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="transaction-form__cards">
        {!isSubAccountMode ? (
          <div className="transaction-form__card transaction-form__picker-card">
            <div className="relative">
              <div
                className="transaction-form__select-row"
                onClick={() => setTypeMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setTypeMenuOpen((open) => !open);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span>
                  账户类型
                  {isEditing ? (
                    <span onClick={(event) => event.stopPropagation()}>
                      <InlineHint text="账户类型创建后不可修改" />
                    </span>
                  ) : null}
                </span>
                <strong>{selectedTypeName}</strong>
                <ChevronRight size={18} />
              </div>
              <PopoverMenu
                groups={[
                  typeOptions.map((option) => ({
                    disabled: option.disabled,
                    label: option.label,
                    onSelect: () => {
                      if (!isEditing) setType(option.id as AccountType);
                    },
                    selected: option.id === type,
                  })),
                ]}
                onOpenChange={setTypeMenuOpen}
                open={typeMenuOpen}
              />
            </div>
          </div>
        ) : null}

        <div className="transaction-form__card">
          <button
            className="account-form__select-row"
            onClick={() => setEmojiOpen(true)}
            type="button"
          >
            <span>图标</span>
            <strong>{icon}</strong>
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="transaction-form__card">
          <FieldRow
            label={isSubAccountMode ? "子账户名称" : "账户名称"}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder={isSubAccountMode ? "如：应急金" : "如：招商银行"}
            value={name}
          />
        </div>

        {isSubAccountMode && !isEditing ? (
          <div className="transaction-form__card">
            <FieldRow
              inputMode="decimal"
              label="初始余额（选填）"
              onChange={(event) => setBalance(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={balance}
            />
          </div>
        ) : null}

        {!isSubAccountMode && type === "credit" ? (
          <div className="transaction-form__card">
            <FieldRow
              inputMode="decimal"
              label="信用额度"
              onChange={(event) => setCreditLimit(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={creditLimit}
            />
            {!isEditing ? (
              <>
                <span className="transaction-form__divider" />
                <FieldRow
                  inputMode="decimal"
                  label="已用额度"
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                  prefix="¥"
                  value={balance}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {!isSubAccountMode && type === "credit" ? (
          <div className="transaction-form__card">
            <DaySelectRow label="账单日" onChange={setBillDay} value={billDay} />
            <span className="transaction-form__divider" />
            <DaySelectRow label="还款日" onChange={setRepayDay} value={repayDay} />
          </div>
        ) : null}

        {!isSubAccountMode && type === "savings" ? (
          !isEditing ? (
            <div className="transaction-form__card">
              <FieldRow
                inputMode="decimal"
                label="当前余额"
                onChange={(event) => setBalance(event.target.value)}
                placeholder="0.00"
                prefix="¥"
                value={balance}
              />
            </div>
          ) : null
        ) : null}

        {!isSubAccountMode && type === "invest" ? (
          <div className="transaction-form__card">
            {!isEditing ? (
              <>
                <FieldRow
                  inputMode="decimal"
                  label="当前余额"
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                  prefix="¥"
                  value={balance}
                />
                <span className="transaction-form__divider" />
              </>
            ) : null}
            <FieldRow
              inputMode="decimal"
              label="投入本金"
              onChange={(event) => setInvestCost(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={investCost}
            />
          </div>
        ) : null}

        {!isSubAccountMode && isLend ? (
          <div className="transaction-form__card">
            {!isEditing ? (
              <>
                <FieldRow
                  inputMode="decimal"
                  label={type === "receivable" ? "待收金额" : "待还金额"}
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                  prefix="¥"
                  value={balance}
                />
                <span className="transaction-form__divider" />
              </>
            ) : null}
            <FieldRow
              label="对方"
              maxLength={80}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="姓名 / 机构"
              value={counterparty}
            />
          </div>
        ) : null}

        {!isSubAccountMode && isLend ? (
          <OptionalDateCard label="到期日" onChange={setDueDate} value={dueDate} />
        ) : null}
      </div>

      <EmojiPicker
        onClose={() => setEmojiOpen(false)}
        onSelect={setIcon}
        open={emojiOpen}
        title={isSubAccountMode ? "选择子账户图标" : "选择账户图标"}
        value={icon}
      />
    </form>
  );
}
