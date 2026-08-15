import type { BusinessOption, CategoryOption } from "@/components/business";
import type {
  Account,
  AccountType,
  Category,
  CategorySnapshot,
  Person,
  Transaction,
  TransactionCreator,
  TransactionType,
} from "@/lib/api";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: "储蓄",
  credit: "信用",
  invest: "投资",
  receivable: "可收回",
  payable: "需归还",
};

/** 直接绑定（资金流动）账户：可收回/需归还账户只通过关联使用，不进主账户选择。 */
const MONEY_ACCOUNT_TYPES: AccountType[] = ["savings", "credit", "invest"];
const ACCOUNT_TYPE_ORDER: AccountType[] = ["savings", "credit", "invest", "receivable", "payable"];
const ACCOUNT_GROUP_OPTION_PREFIX = "__account_group__:";
const FILTER_SUB_ACCOUNT_PREFIX = "__filter_sub_account__:";

type MoneyAccountOptionsConfig = {
  /** 筛选场景需要父账户可选；表单选择场景有子账户时只允许选子账户。 */
  parentSelectable?: boolean;
};

function accountGroupOptionId(accountId: string): string {
  return `${ACCOUNT_GROUP_OPTION_PREFIX}${accountId}`;
}

/** 筛选弹层里「某账户下的某个子账户」选项 id；解码见 {@link resolveFilterAccountOptionId}。 */
export function filterSubAccountOptionId(accountId: string, subAccountId: string): string {
  return `${FILTER_SUB_ACCOUNT_PREFIX}${accountId}:${subAccountId}`;
}

function accountOrderIndex(type: AccountType): number {
  const index = ACCOUNT_TYPE_ORDER.indexOf(type);
  return index === -1 ? ACCOUNT_TYPE_ORDER.length : index;
}

function orderedAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort(
    (a, b) =>
      accountOrderIndex(a.type) - accountOrderIndex(b.type) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
}

function orderedSubAccounts(account: Account) {
  return account.subAccounts
    .filter((sub) => !sub.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.isDefault ? -1 : b.isDefault ? 1 : 0));
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

/** 转账不能选分类，列表统一用这个图标。 */
export const TRANSFER_ICON = "💱";

/** 分类/子分类的实时图标与名称索引，按 id 查询。 */
export type CategoryLookup = Map<string, { icon: string | null; name: string }>;

export function buildCategoryLookup(categories: Category[]): CategoryLookup {
  const lookup: CategoryLookup = new Map();
  for (const category of categories) {
    lookup.set(category.id, { icon: category.icon, name: category.name });
    for (const sub of category.subcategories) {
      lookup.set(sub.id, { icon: sub.icon, name: sub.name });
    }
  }
  return lookup;
}

export type ResolvedCategory = {
  /** 父分类名称（实时优先，回退快照）。 */
  name: string | null;
  /** 父分类图标（实时优先，回退快照）。 */
  icon: string | null;
  /** 子分类名称，无子分类时为 null。 */
  subcategoryName: string | null;
  /** 子分类图标，无子分类时为 null。 */
  subcategoryIcon: string | null;
  /** 列表行展示用的单个图标：子分类优先于父分类。 */
  displayIcon: string | null;
};

/**
 * 记账展示：优先用快照中的 id 命中分类接口的实时数据（名称/图标），
 * 未命中（分类已删除）再回退到快照。子分类优先于父分类，与历史快照顺序一致。
 */
export function resolveCategoryDisplay(
  snapshot: CategorySnapshot | null | undefined,
  lookup: CategoryLookup,
): ResolvedCategory {
  if (!snapshot) {
    return {
      name: null,
      icon: null,
      subcategoryName: null,
      subcategoryIcon: null,
      displayIcon: null,
    };
  }
  const liveCat = lookup.get(snapshot.id);
  const name = liveCat?.name ?? snapshot.name ?? null;
  const icon = liveCat?.icon ?? snapshot.icon ?? null;
  const liveSub = snapshot.subcategoryId ? lookup.get(snapshot.subcategoryId) : undefined;
  const subcategoryName = snapshot.subcategoryId
    ? (liveSub?.name ?? snapshot.subcategoryName ?? null)
    : null;
  const subcategoryIcon = snapshot.subcategoryId
    ? (liveSub?.icon ?? snapshot.subcategoryIcon ?? null)
    : null;
  return { name, icon, subcategoryName, subcategoryIcon, displayIcon: subcategoryIcon ?? icon };
}

/** 记账列表行的分类展示字段（标题 / 分类名 / 图标），实时优先。转账请自行处理。 */
export function categoryRowProps(
  transaction: Pick<Transaction, "type" | "categorySnapshot">,
  lookup: CategoryLookup,
) {
  const resolved = resolveCategoryDisplay(transaction.categorySnapshot, lookup);
  const isIncome = transaction.type === "income";
  const title = resolved.subcategoryName ?? resolved.name ?? (isIncome ? "收入" : "支出");
  return {
    title,
    categoryName: resolved.name ?? title,
    categoryIcon: resolved.displayIcon ?? (isIncome ? "income" : undefined),
  };
}

export function moneyAccountOptions(
  accounts: Account[],
  config: MoneyAccountOptionsConfig = {},
): BusinessOption[] {
  const parentSelectable = config.parentSelectable ?? false;
  const options: BusinessOption[] = [];
  for (const account of orderedAccounts(accounts)) {
    if (!MONEY_ACCOUNT_TYPES.includes(account.type)) continue;
    const subAccounts = orderedSubAccounts(account);
    // 只有存在“命名子账户”（默认子账户以外）时才展示子账户层级；否则账户作为整体可选。
    const namedSubs = subAccounts.filter((sub) => !sub.isDefault);
    const defaultSub = subAccounts.find((sub) => sub.isDefault);
    if (namedSubs.length === 0) {
      // 简单账户：整体可选。表单选项 id 用默认子账户 id，使记账落到默认子账户且编辑可正确回填；
      // 筛选场景用账户 id（等价于筛选该账户全部记录）。
      options.push({
        id: !parentSelectable && defaultSub ? defaultSub.id : account.id,
        label: account.name,
        icon: account.icon ?? undefined,
      });
      continue;
    }
    // 有命名子账户：父账户作为分组，列出全部子账户（含默认子账户，默认排最前）。
    const parentId = parentSelectable ? account.id : accountGroupOptionId(account.id);
    options.push({
      id: parentId,
      label: account.name,
      icon: account.icon ?? undefined,
      disabled: !parentSelectable,
    });
    for (const sub of subAccounts) {
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
  return orderedAccounts(accounts)
    .filter((account) => account.type === kind)
    .map((account) => ({ id: account.id, label: account.name }));
}

export function personOptions(people: Person[]): BusinessOption[] {
  return people.map((person) => ({ id: person.id, label: person.name }));
}

/** 记账人筛选项：以用户 id 为值，已移除成员标注「已移除」。 */
export function creatorOptions(creators: TransactionCreator[]): BusinessOption[] {
  return creators.map((creator) => {
    const name = creator.alias || creator.account || `用户 ${creator.userId.slice(0, 8)}`;
    return {
      id: creator.userId,
      label: creator.removed ? `${name}（已移除）` : name,
    };
  });
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
