"use client";

import { Edit3, Trash2 } from "lucide-react";
import { Button, Switch } from "@/components/ui";
import type { Account, AutoRule, Category, Insurance, ItemAsset, Person } from "@/lib/api";
import {
  accountSummary,
  amountToneClass,
  categorySummary,
  formatDateLabel,
  formatFullDate,
  personName,
  REPEAT_LABELS,
  signedAmountText,
  transactionTypeLabel,
  transferAccountSummary,
  upcomingDates,
} from "./auto-utils";

type AutoRuleDetailSheetProps = {
  accounts: Account[];
  categories: Category[];
  insurances: Insurance[];
  items: ItemAsset[];
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  people: Person[];
  pendingToggle?: boolean;
  rule: AutoRule;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[50px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex-1 text-[15px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="min-w-0 max-w-[62%] truncate text-right text-[15px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

export function AutoRuleDetailSheet({
  accounts,
  categories,
  insurances,
  items,
  onDelete,
  onEdit,
  onToggle,
  people,
  pendingToggle = false,
  rule,
}: AutoRuleDetailSheetProps) {
  const insuranceName =
    insurances.find((insurance) => insurance.id === rule.insuranceId)?.name ?? null;
  const itemName = items.find((item) => item.id === rule.itemId)?.name ?? null;
  const relationCount = rule.relationPayload?.length ?? 0;
  const summary =
    rule.type === "transfer"
      ? transferAccountSummary(
          accounts,
          rule.fromAccountId,
          rule.fromSubAccountId,
          rule.toAccountId,
          rule.toSubAccountId,
        )
      : categorySummary(categories, rule.categoryId, rule.subcategoryId);
  const account = accountSummary(accounts, rule.accountId, rule.subAccountId);
  const fromAccount = accountSummary(accounts, rule.fromAccountId, rule.fromSubAccountId);
  const toAccount = accountSummary(accounts, rule.toAccountId, rule.toSubAccountId);
  const upcoming = upcomingDates(rule.startDate, rule.repeatRule);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex items-center gap-3 rounded-[22px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--color-control-fill-muted)] text-[26px]">
          {summary.icon}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[19px] text-[var(--color-text-primary)]">
            {summary.name}
          </strong>
          <span className="mt-0.5 block text-[13px] text-[var(--color-text-muted)]">
            {transactionTypeLabel(rule.type)} · {REPEAT_LABELS[rule.repeatRule]}
          </span>
        </span>
        <strong className={`shrink-0 text-[21px] ${amountToneClass(rule.type)}`}>
          {signedAmountText(rule.type, rule.amountMicros)}
        </strong>
      </div>

      <section className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
        <div className="flex min-h-[56px] items-center gap-3 px-4">
          <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
            {rule.enabled ? "正在运行" : "已暂停"}
          </span>
          <Switch
            checked={rule.enabled}
            disabled={pendingToggle}
            label="启用自动记账"
            onCheckedChange={onToggle}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">规则</h3>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          {rule.type === "transfer" ? (
            <>
              <DetailRow label="转出账户" value={fromAccount.name} />
              <DetailRow label="转入账户" value={toAccount.name} />
              <DetailRow label="人员" value={personName(people, rule.personId)} />
            </>
          ) : (
            <>
              <DetailRow label="分类" value={summary.fullName} />
              <DetailRow label="账户" value={account.name} />
              <DetailRow label="人员" value={personName(people, rule.personId)} />
              {relationCount > 0 ? (
                <DetailRow label="可收回 / 需归还" value={`${relationCount} 项`} />
              ) : null}
              {insuranceName ? <DetailRow label="保险" value={insuranceName} /> : null}
              {itemName ? <DetailRow label="关联物品" value={itemName} /> : null}
            </>
          )}
          <DetailRow label="重复周期" value={REPEAT_LABELS[rule.repeatRule]} />
          <DetailRow label="起始日期" value={formatFullDate(rule.startDate)} />
          <DetailRow
            label="下次生成"
            value={rule.enabled ? formatDateLabel(rule.nextRunOn) : "暂停中"}
          />
        </div>
      </section>

      {rule.note ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            备注
          </h3>
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]">
            {rule.note}
          </div>
        </section>
      ) : null}

      {upcoming.length > 0 && rule.enabled ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            即将生成
          </h3>
          <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            {upcoming.map((date, index) => (
              <div
                className="flex min-h-[46px] items-center gap-3 px-4 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
                key={date}
              >
                <span className="h-2 w-2 rounded-full bg-[var(--color-tint)]" />
                <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
                  {formatFullDate(date)}
                </span>
                {index === 0 ? (
                  <span className="text-xs font-semibold text-[var(--color-tint)]">下次</span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          className="!bg-white"
          icon={<Edit3 size={17} />}
          onClick={onEdit}
          variant="secondary"
        >
          编辑规则
        </Button>
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          icon={<Trash2 size={17} />}
          onClick={onDelete}
          variant="danger"
        >
          删除规则
        </Button>
      </div>
    </div>
  );
}
