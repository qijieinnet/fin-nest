// 按卡号尾号匹配账户：账户表没有卡号字段，用户习惯把尾号写进账户/子账户名称，
// 如「招行信用卡(8899)」「工行储蓄卡 尾号1234」「建行6217…5678」。账单截图上的付款方式
// 也多带尾号（「招商银行信用卡(8899)」），同一家银行有多张卡时尾号比名称可靠得多。

type TailAccount = {
  id: string;
  name: string;
  type: string;
  subAccounts: Array<{ id: string; name: string; isDefault: boolean }>;
};

export type TailMatch = { accountId: string; subAccountId?: string };

/** 从名称里取尾号：最后一段连续数字（至少 4 位）的末 4 位；没有返回 undefined。 */
export function accountTailOf(name: string): string | undefined {
  const runs = name.match(/\d{4,}/g);
  return runs ? runs[runs.length - 1]!.slice(-4) : undefined;
}

/** 规整模型传来的尾号：只留数字，至少 4 位取末 4 位；「*8899」「尾号8899」都能认。 */
export function normalizeAccountTail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

/**
 * 按尾号在可记账账户里找唯一匹配：子账户名称上的尾号优先（更具体），其次账户名称。
 * 同一层级命中多个时视为有歧义，返回 undefined，交由模型按名称判断。
 */
export function matchAccountByTail(
  accounts: TailAccount[],
  tail: string,
  allowedTypes: ReadonlySet<string>,
): TailMatch | undefined {
  const usable = accounts.filter((account) => allowedTypes.has(account.type));
  const subHits: TailMatch[] = [];
  const accountHits: TailMatch[] = [];
  for (const account of usable) {
    for (const sub of account.subAccounts) {
      if (accountTailOf(sub.name) === tail) {
        subHits.push({ accountId: account.id, subAccountId: sub.id });
      }
    }
    if (accountTailOf(account.name) === tail) accountHits.push({ accountId: account.id });
  }
  if (subHits.length > 0) return subHits.length === 1 ? subHits[0] : undefined;
  return accountHits.length === 1 ? accountHits[0] : undefined;
}

/**
 * 模型选定的账户/子账户名称上带的尾号（子账户优先）。用来发现「图上尾号 8899，
 * 模型却挑了同银行尾号 1234 的那张卡」这种明确选错的情况。
 */
export function selectedAccountTail(
  accounts: TailAccount[],
  accountId: string | undefined,
  subAccountId: string | undefined,
): string | undefined {
  if (!accountId) return undefined;
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return undefined;
  // 没指定子账户时交易会落默认子账户，按默认子账户的名称核对。
  const sub = subAccountId
    ? account.subAccounts.find((item) => item.id === subAccountId)
    : account.subAccounts.find((item) => item.isDefault);
  return (sub && accountTailOf(sub.name)) ?? accountTailOf(account.name);
}

/**
 * 账户名上的尾号命中后，在该账户下挑一个与尾号不冲突的子账户（名称没写尾号或尾号一致）：
 * 依次是模型选的、尾号一致的唯一一个、默认子账户、第一个不冲突的。
 * 子账户全都写着别的尾号时返回 ok=false——宁可让用户自己选，也不落到另一张卡上。
 * 返回的 subAccountId 为 undefined 表示该账户没有子账户。
 */
export function pickSubAccountForTail(
  account: TailAccount,
  tail: string,
  preferredSubAccountId: string | undefined,
): { ok: true; subAccountId?: string } | { ok: false } {
  const subs = account.subAccounts;
  if (subs.length === 0) return { ok: true };
  const compatible = (sub: TailAccount["subAccounts"][number]) => {
    const subTail = accountTailOf(sub.name);
    return !subTail || subTail === tail;
  };
  const preferred = subs.find((sub) => sub.id === preferredSubAccountId);
  if (preferred && compatible(preferred)) return { ok: true, subAccountId: preferred.id };
  const exact = subs.filter((sub) => accountTailOf(sub.name) === tail);
  if (exact.length === 1) return { ok: true, subAccountId: exact[0]!.id };
  const fallback = subs.find((sub) => sub.isDefault && compatible(sub)) ?? subs.find(compatible);
  return fallback ? { ok: true, subAccountId: fallback.id } : { ok: false };
}
