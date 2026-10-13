import { parseMoneyToMicros } from "@/lib/money";
import type { TransactionFormModel, TransactionSeed } from "./useTransactionFormModel";

/**
 * 快捷记账点「全屏」跳到 /bills/new 时暂存的草稿。
 * 只活到目标页读走为止，所以放 sessionStorage 而不是 URL（备注等内容不该进地址栏）。
 */
export const QUICK_ENTRY_SEED_KEY = "fin-nest.quick-entry-seed";

/**
 * 把键盘里已经填的内容拍成 seed。
 * 键盘能改的就是这几项，关联/附件/资产那些字段快捷记账本来就碰不到，不用带。
 */
export function quickEntrySeed(model: TransactionFormModel): TransactionSeed {
  return {
    type: model.type,
    ...amountSeed(model),
    // 选中的可能是二级分类；表单初始化取的是 subcategoryId ?? categoryId，放哪个字段都还原得回来。
    categoryId: model.categoryId,
    // accountSel 本身就是 accountSelectionId(accountId, subAccountId) 的结果（子账户优先），
    // 原样放回 accountId 就能被同一个函数还原成同一个选中项。
    accountId: model.accountEnabled ? model.accountSel : null,
    // 转账的两个账户同理（accountSelectionId 的结果放回 xxxAccountId 就能还原）。
    fromAccountId: model.type === "transfer" ? model.fromSel : null,
    toAccountId: model.type === "transfer" ? model.toSel : null,
    personId: model.personEnabled ? model.personId : null,
    occurredOn: model.occurredOn,
    note: model.note,
  };
}

/**
 * 金额部分。外币时键盘里的金额是入账币种（$10），不能当本币带过去：
 * 折算已就绪就把本币金额 + 原币字段整套带上（保留用户手改过的折合值）；
 * 还没算出来就只带原币，让全屏页按汇率重新折算。
 */
function amountSeed(model: TransactionFormModel): Partial<TransactionSeed> {
  const fx = model.fx;
  // 模板还在等汇率反推本币：带上原币和「要重算」标记，全屏页接着反推，不能把估算值固化下来。
  if (fx.pendingRecompute) {
    const estimate = parseMoneyToMicros(model.amount, { decimalPlaces: model.decimalPlaces });
    return {
      grossAmountMicros: estimate.ok ? estimate.amountMicros : null,
      originalCurrency: fx.pendingRecompute.currency,
      originalAmountMicros: fx.pendingRecompute.micros.toString(),
      fxRecompute: true,
    };
  }
  const built = fx.buildFx();
  if (built.ok) {
    const gross = parseMoneyToMicros(built.value.grossInput, {
      decimalPlaces: model.decimalPlaces,
    });
    return {
      grossAmountMicros: gross.ok ? gross.amountMicros : null,
      originalCurrency: built.value.fields.originalCurrency ?? null,
      originalAmountMicros: built.value.fields.originalAmountMicros ?? null,
      toCurrency: built.value.fields.toCurrency ?? null,
      toAmountMicros: built.value.fields.toAmountMicros ?? null,
    };
  }
  const entry = parseMoneyToMicros(model.amount, { decimalPlaces: fx.entryDecimalPlaces });
  // 没填或填了一半（"12."）就不带过去，全屏页按空金额开，用户接着输。
  if (!entry.ok) return { grossAmountMicros: null };
  if (fx.entryCurrency === fx.baseCurrency) return { grossAmountMicros: entry.amountMicros };
  return {
    grossAmountMicros: null,
    originalCurrency: fx.entryCurrency,
    originalAmountMicros: entry.amountMicros,
    fxRecompute: true,
  };
}

export function writeQuickEntrySeed(seed: TransactionSeed): void {
  try {
    sessionStorage.setItem(QUICK_ENTRY_SEED_KEY, JSON.stringify(seed));
  } catch {
    // 存不下（隐私模式/配额）就当没草稿，全屏页开一张空表单，不该因此拦住跳转。
  }
}

/** 读一次即清除：草稿只为这一次跳转服务，留着会污染下一次「记一笔」。 */
export function readQuickEntrySeed(): TransactionSeed | null {
  try {
    const raw = sessionStorage.getItem(QUICK_ENTRY_SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(QUICK_ENTRY_SEED_KEY);
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as TransactionSeed) : null;
  } catch {
    return null;
  }
}
