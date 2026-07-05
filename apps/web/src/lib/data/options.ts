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
const ACCOUNT_GROUP_OPTION_PREFIX = "__account_group__:";
const FILTER_DEFAULT_SUB_ACCOUNT_PREFIX = "__filter_default_sub_account__:";
const FILTER_SUB_ACCOUNT_PREFIX = "__filter_sub_account__:";
export const DEFAULT_SUB_ACCOUNT_QUERY_VALUE = "default";

type MoneyAccountOptionsConfig = {
  /** 筛选场景需要父账户可选；表单选择场景有子账户时只允许选子账户。 */
  parentSelectable?: boolean;
};

function accountGroupOptionId(accountId: string): string {
  return `${ACCOUNT_GROUP_OPTION_PREFIX}${accountId}`;
}

function filterDefaultSubAccountOptionId(accountId: string): string {
  return `${FILTER_DEFAULT_SUB_ACCOUNT_PREFIX}${accountId}`;
}

function filterSubAccountOptionId(accountId: string, subAccountId: string): string {
  return `${FILTER_SUB_ACCOUNT_PREFIX}${accountId}:${subAccountId}`;
}

export function categoryOptions(
  categories: Category[],
  type: "expense" | "income",
): CategoryOption[] {
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

export function moneyAccountOptions(
  accounts: Account[],
  config: MoneyAccountOptionsConfig = {},
): BusinessOption[] {
  const parentSelectable = config.parentSelectable ?? false;
  const options: BusinessOption[] = [];
  for (const account of accounts) {
    if (!MONEY_ACCOUNT_TYPES.includes(account.type)) continue;
    const subAccounts = account.subAccounts.filter((sub) => !sub.archivedAt);
    const showSubAccounts = subAccounts.length > 0;
    const parentId =
      parentSelectable || !showSubAccounts ? account.id : accountGroupOptionId(account.id);
    options.push({
      id: parentId,
      label: account.name,
      icon: account.icon ?? undefined,
      disabled: showSubAccounts && !parentSelectable,
    });
    if (showSubAccounts && !parentSelectable) {
      options.push({
        id: account.id,
        label: account.defaultSubAccountName ?? "默认",
        icon: account.defaultSubAccountIcon ?? account.icon ?? undefined,
        parentId,
      });
    }
    if (showSubAccounts && parentSelectable) {
      options.push({
        id: filterDefaultSubAccountOptionId(account.id),
        label: account.defaultSubAccountName ?? "默认",
        icon: account.defaultSubAccountIcon ?? account.icon ?? undefined,
        parentId,
      });
    }
    for (const sub of subAccounts) {
      if (sub.archivedAt) continue;
      options.push({
        id: parentSelectable ? filterSubAccountOptionId(account.id, sub.id) : sub.id,
        label: sub.name,
        icon: sub.icon ?? undefined,
        parentId,
      });
    }
  }
  return options;
}

export function firstSelectableAccountOptionId(options: BusinessOption[]): string | null {
  return options.find((option) => !option.disabled)?.id ?? null;
}

export function resolveFilterAccountOptionId(selectedId: string | null | undefined): {
  accountId?: string;
  subAccountId?: string;
} {
  if (!selectedId) return {};
  if (selectedId.startsWith(FILTER_DEFAULT_SUB_ACCOUNT_PREFIX)) {
    return {
      accountId: selectedId.slice(FILTER_DEFAULT_SUB_ACCOUNT_PREFIX.length),
      subAccountId: DEFAULT_SUB_ACCOUNT_QUERY_VALUE,
    };
  }
  if (selectedId.startsWith(FILTER_SUB_ACCOUNT_PREFIX)) {
    const rest = selectedId.slice(FILTER_SUB_ACCOUNT_PREFIX.length);
    const [accountId, subAccountId] = rest.split(":");
    return accountId && subAccountId ? { accountId, subAccountId } : {};
  }
  return { accountId: selectedId };
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

export function accountName(
  accounts: Account[],
  accountId: string | null | undefined,
): string | undefined {
  if (!accountId) return undefined;
  const account = accounts.find((item) => item.id === accountId);
  return account?.name;
}

/** 交易类型对应的关联类型（可收回/需归还）。转账不支持。 */
export function relationKindFor(
  type: TransactionType,
  kind: "receivable" | "payable",
):
  | "receivable_from_expense"
  | "payable_from_expense"
  | "receivable_from_income"
  | "payable_from_income"
  | null {
  if (type === "expense")
    return kind === "receivable" ? "receivable_from_expense" : "payable_from_expense";
  if (type === "income")
    return kind === "receivable" ? "receivable_from_income" : "payable_from_income";
  return null;
}
