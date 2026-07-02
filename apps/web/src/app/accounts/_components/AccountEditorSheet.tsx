"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { DateWheelPicker } from "@/components/business";
import { IconButton, Input, Switch } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type AccountType,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { ACCOUNT_EMOJI, ACCOUNT_GROUPS, microsToInput } from "./account-utils";

type AccountEditorSheetProps = {
  account?: Account;
  ledgerId: string;
};

function parseOptionalDay(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const day = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`${label}需为 1-31 的整数`);
  return day;
}

export function AccountEditorSheet({ account, ledgerId }: AccountEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(account);

  const [type, setType] = useState<AccountType>(account?.type ?? "savings");
  const [name, setName] = useState(account?.name ?? "");
  const [icon, setIcon] = useState(account?.icon ?? "💵");
  const [balance, setBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState(() => microsToInput(account?.creditLimitMicros));
  const [investCost, setInvestCost] = useState(() => microsToInput(account?.investmentCostMicros));
  const [counterparty, setCounterparty] = useState(account?.counterparty ?? "");
  const [dueDate, setDueDate] = useState(account?.dueDate?.slice(0, 10) ?? "");
  const [billDay, setBillDay] = useState(account?.billDay ? String(account.billDay) : "");
  const [repayDay, setRepayDay] = useState(account?.repayDay ? String(account.repayDay) : "");
  const [includeInNetWorth, setIncludeInNetWorth] = useState(account?.includeInNetWorth ?? true);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const limitParsed = creditLimit.trim() ? parseMoneyToMicros(creditLimit) : null;
      if (limitParsed && !limitParsed.ok) throw new Error("信用额度格式不正确");
      const costParsed = investCost.trim() ? parseMoneyToMicros(investCost) : null;
      if (costParsed && !costParsed.ok) throw new Error("投入本金格式不正确");
      const billDayValue = parseOptionalDay(billDay, "账单日");
      const repayDayValue = parseOptionalDay(repayDay, "还款日");

      const shared = {
        name: trimmedName,
        icon,
        includeInNetWorth,
        creditLimitMicros: type === "credit" ? limitParsed?.amountMicros : undefined,
        investmentCostMicros: type === "invest" ? costParsed?.amountMicros : undefined,
        counterparty:
          type === "receivable" || type === "payable" ? counterparty.trim() || undefined : undefined,
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

      const balanceParsed = balance.trim() ? parseMoneyToMicros(balance, { allowNegative: true }) : null;
      if (balanceParsed && !balanceParsed.ok) throw new Error("余额格式不正确");
      return apiRequest<Account>(ledgerApiPath(ledgerId, "/accounts"), {
        method: "POST",
        body: { ...shared, type, balanceMicros: balanceParsed?.amountMicros },
        headers: { "idempotency-key": createClientId("account") },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) });
      showToast({ tone: "success", message: isEditing ? "账户已更新" : "账户已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const isLend = type === "receivable" || type === "payable";

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑账户" : "新建账户"}
        </h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存账户"
          variant="primary"
          type="submit"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">账户类型</h3>
        <div className="flex flex-wrap gap-2 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
          {ACCOUNT_GROUPS.map((group) => (
            <button
              className={cn(
                "rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                type === group.key
                  ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
                  : "bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)]",
                isEditing && type !== group.key && "opacity-45",
              )}
              disabled={isEditing}
              key={group.key}
              onClick={() => setType(group.key)}
              type="button"
            >
              {group.name}
            </button>
          ))}
        </div>
        {isEditing ? (
          <p className="px-1 text-xs text-[var(--color-text-muted)]">账户类型创建后不可修改</p>
        ) : null}
      </section>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3">
          <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-control-fill-muted)] text-[23px]">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <Input
              aria-label="账户名称"
              label="账户名称"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：招商银行"
              value={name}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_EMOJI.map((emoji) => (
            <button
              aria-label={`选择图标 ${emoji}`}
              className={cn(
                "flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-[19px] transition-colors",
                icon === emoji ? "bg-[var(--color-tint)]" : "bg-[var(--color-control-fill-muted)]",
              )}
              key={emoji}
              onClick={() => setIcon(emoji)}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        {!isEditing ? (
          <Input
            inputMode="decimal"
            label={type === "credit" ? "已用额度" : type === "receivable" ? "待收金额" : type === "payable" ? "待还金额" : "当前余额"}
            onChange={(event) => setBalance(event.target.value)}
            placeholder="0.00"
            prefix="¥"
            value={balance}
          />
        ) : null}
        {type === "credit" ? (
          <>
            <Input
              inputMode="decimal"
              label="信用额度"
              onChange={(event) => setCreditLimit(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={creditLimit}
            />
            <Input
              inputMode="numeric"
              label="账单日（选填，每月几号）"
              onChange={(event) => setBillDay(event.target.value)}
              placeholder="如：5"
              value={billDay}
            />
            <Input
              inputMode="numeric"
              label="还款日（选填，每月几号）"
              onChange={(event) => setRepayDay(event.target.value)}
              placeholder="如：23"
              value={repayDay}
            />
          </>
        ) : null}
        {type === "invest" ? (
          <Input
            inputMode="decimal"
            label="投入本金"
            onChange={(event) => setInvestCost(event.target.value)}
            placeholder="0.00"
            prefix="¥"
            value={investCost}
          />
        ) : null}
        {isLend ? (
          <>
            <Input
              label="对方"
              maxLength={80}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="姓名 / 机构"
              value={counterparty}
            />
            <OptionalDateRow label="到期日" onChange={setDueDate} value={dueDate} />
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-[var(--color-text-primary)]">不计入总资产</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            开启后该账户余额不计入净资产统计
          </p>
        </div>
        <Switch
          checked={!includeInNetWorth}
          label="不计入总资产"
          onCheckedChange={(checked) => setIncludeInNetWorth(!checked)}
        />
      </div>
    </form>
  );
}

function OptionalDateRow({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (!value) {
    return (
      <button
        className="flex items-center justify-between rounded-[12px] bg-[var(--color-control-fill-muted)] px-4 py-3 text-[15px] text-[var(--color-text-secondary)]"
        onClick={() => {
          const now = new Date();
          const month = String(now.getMonth() + 1).padStart(2, "0");
          const day = String(now.getDate()).padStart(2, "0");
          onChange(`${now.getFullYear()}-${month}-${day}`);
        }}
        type="button"
      >
        <span>{label}</span>
        <span className="text-[var(--color-text-muted)]">点击选择</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <DateWheelPicker label={label} onValueChange={onChange} value={value} />
      </div>
      <button
        className="shrink-0 text-[13px] text-[var(--color-text-muted)]"
        onClick={() => onChange("")}
        type="button"
      >
        清除
      </button>
    </div>
  );
}
