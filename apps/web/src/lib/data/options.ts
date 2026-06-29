import type { BusinessOption, CategoryOption } from "@/components/business";
import type { Account, AccountType, Category, Person, TransactionType } from "@/lib/api";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: "储蓄",
  credit: "信用",
  invest: "投资",
  receivable: "可收回",
  payable: "需归还",
};

/** 直接绑定（资金流动）账户：可收回/需归还账户只通过关联使用，不进主账户选择。 */
const MONEY_ACCOUNT_TYPES: AccountType[] = ["savings", "credit", "invest"];

export function categoryOptions(categories: Category[], type: "expense" | "income"): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const category of categories) {
    if (category.type !== type) continue;
    options.push({
      id: category.id,
      label: category.name,
      iconName: category.icon ?? undefined,
      kind: category.type,
    });
    for (const sub of category.subcategories) {
      if (sub.archivedAt) continue;
      options.push({
        id: sub.id,
        label: sub.name,
        parentId: category.id,
        iconName: sub.icon ?? undefined,
        kind: category.type,
      });
    }
  }
  return options;
}

export function moneyAccountOptions(accounts: Account[]): BusinessOption[] {
  const options: BusinessOption[] = [];
  for (const account of accounts) {
    if (!MONEY_ACCOUNT_TYPES.includes(account.type)) continue;
    options.push({ id: account.id, label: account.name });
    for (const sub of account.subAccounts) {
      if (sub.archivedAt) continue;
      options.push({ id: sub.id, label: sub.name, parentId: account.id });
    }
  }
  return options;
}

export function relationAccountOptions(
  accounts: Account[],
  kind: "receivable" | "payable",
): BusinessOption[] {
  return accounts
    .filter((account) => account.type === kind)
    .map((account) => ({ id: account.id, label: account.name }));
}

export function personOptions(people: Person[]): BusinessOption[] {
  return people.map((person) => ({ id: person.id, label: person.name }));
}

/** 把账户选择（可能是子账户 id）解析为 accountId + subAccountId。 */
export function resolveAccountSelection(
  accounts: Account[],
  selectedId: string | null,
): { accountId?: string; subAccountId?: string } {
  if (!selectedId) return {};
  for (const account of accounts) {
    if (account.id === selectedId) return { accountId: account.id };
    const sub = account.subAccounts.find((item) => item.id === selectedId);
    if (sub) return { accountId: account.id, subAccountId: sub.id };
  }
  return { accountId: selectedId };
}

/** 反向：从 accountId/subAccountId 得到 AccountPicker 的选中 id（优先子账户）。 */
export function accountSelectionId(
  accountId: string | null | undefined,
  subAccountId: string | null | undefined,
): string | null {
  return subAccountId ?? accountId ?? null;
}

export function accountName(accounts: Account[], accountId: string | null | undefined): string | undefined {
  if (!accountId) return undefined;
  const account = accounts.find((item) => item.id === accountId);
  return account?.name;
}

/** 交易类型对应的关联类型（可收回/需归还）。转账不支持。 */
export function relationKindFor(
  type: TransactionType,
  kind: "receivable" | "payable",
): "receivable_from_expense" | "payable_from_expense" | "receivable_from_income" | "payable_from_income" | null {
  if (type === "expense") return kind === "receivable" ? "receivable_from_expense" : "payable_from_expense";
  if (type === "income") return kind === "receivable" ? "receivable_from_income" : "payable_from_income";
  return null;
}
