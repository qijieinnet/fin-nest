"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { SwipeActionRow, TransactionGroup, TransactionRow } from "@/components/business";
import {
  type Account,
  type AutoPendingTransaction,
  type Category,
} from "@/lib/api";
import {
  accountSummary,
  categorySummary,
  transferAccountSummary,
} from "@/app/more/auto/_components/auto-utils";
import { dayLabel } from "../_components/bill-utils";

type PendingDayGroup = {
  date: string;
  expenseMicros: bigint;
  incomeMicros: bigint;
  items: AutoPendingTransaction[];
};

type PendingTransactionListProps = {
  accounts: Account[];
  busy?: boolean;
  categories: Category[];
  items: AutoPendingTransaction[];
  onConfirm: (item: AutoPendingTransaction) => void;
  onDelete: (item: AutoPendingTransaction) => void;
  onEdit: (item: AutoPendingTransaction) => void;
  onOpen: (item: AutoPendingTransaction) => void;
};

/** 按计划入账日分组（时间近的在前，同账单列表方向一致）。 */
function groupPendingByDay(items: AutoPendingTransaction[]): PendingDayGroup[] {
  const map = new Map<string, PendingDayGroup>();
  for (const item of items) {
    const date = item.scheduledFor.slice(0, 10);
    let group = map.get(date);
    if (!group) {
      group = { date, expenseMicros: 0n, incomeMicros: 0n, items: [] };
      map.set(date, group);
    }
    group.items.push(item);
    const amount = BigInt(item.amountMicros);
    if (item.type === "expense") group.expenseMicros += amount;
    if (item.type === "income") group.incomeMicros += amount;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function pendingRowProps(item: AutoPendingTransaction, accounts: Account[], categories: Category[]) {
  if (item.type === "transfer") {
    const summary = transferAccountSummary(
      accounts,
      item.fromAccountId,
      item.fromSubAccountId,
      item.toAccountId,
      item.toSubAccountId,
    );
    return {
      type: "transfer" as const,
      title: "转账",
      categoryName: "转账",
      categoryIcon: "transfer",
      description: summary.fullName,
      amountMicros: item.amountMicros,
    };
  }
  const summary = categorySummary(categories, item.categoryId, item.subcategoryId);
  const account = accountSummary(accounts, item.accountId, item.subAccountId);
  return {
    type: item.type,
    title: summary.name,
    categoryName: summary.name,
    categoryIcon: summary.icon,
    amountMicros: item.amountMicros,
    accountName: account.name,
    description: item.note ?? undefined,
  };
}

export function PendingTransactionList({
  accounts,
  busy = false,
  categories,
  items,
  onConfirm,
  onDelete,
  onEdit,
  onOpen,
}: PendingTransactionListProps) {
  const groups = groupPendingByDay(items);

  return (
    <div className="bill-list-shell flex flex-col gap-5">
      {groups.map((group) => (
        <TransactionGroup
          dateLabel={dayLabel(group.date)}
          incomeMicros={group.incomeMicros > 0n ? group.incomeMicros : undefined}
          key={group.date}
          totalMicros={group.expenseMicros > 0n ? group.expenseMicros : undefined}
        >
          {group.items.map((item) => (
            <SwipeActionRow
              actions={[
                {
                  icon: <Pencil size={20} />,
                  label: "编辑",
                  onClick: () => onEdit(item),
                },
                {
                  icon: <Trash2 size={20} />,
                  label: "删除",
                  onClick: () => {
                    if (!busy) onDelete(item);
                  },
                  tone: "danger",
                },
              ]}
              key={item.id}
              leadingActions={[
                {
                  icon: <Check size={20} />,
                  label: "确认",
                  onClick: () => {
                    if (!busy) onConfirm(item);
                  },
                  tone: "primary",
                },
              ]}
            >
              <TransactionRow onClick={() => onOpen(item)} {...pendingRowProps(item, accounts, categories)} />
            </SwipeActionRow>
          ))}
        </TransactionGroup>
      ))}
    </div>
  );
}
