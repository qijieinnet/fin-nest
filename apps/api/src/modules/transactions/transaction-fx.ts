import { AppError } from "@fin-nest/backend";

/**
 * 交易的多币种规则（docs/MULTI_CURRENCY_PLAN.md §2.1），纯函数，便于单测。
 *
 * - gross/effective 永远是账本本币；
 * - original_* 是「外币那一侧」的原币金额；to_* 只在两侧都是外币且币种不同的转账上出现；
 * - 交易落到每个账户上的金额按账户币种取（`sideAmount`），取不到就是 400。
 */

export type TransactionFxInput = {
  type: string;
  currency?: string | null;
  originalCurrency?: string | null;
  originalAmountMicros?: string | null;
  toCurrency?: string | null;
  toAmountMicros?: string | null;
};

export type TransactionFx = {
  originalCurrency: string | null;
  originalAmountMicros: bigint | null;
  toCurrency: string | null;
  toAmountMicros: bigint | null;
};

export const NO_FX: TransactionFx = {
  originalCurrency: null,
  originalAmountMicros: null,
  toCurrency: null,
  toAmountMicros: null,
};

function present(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/** 校验并归一化 DTO 里的币种字段（不涉及账户，账户相关的校验在 `sideAmount`）。 */
export function normalizeTransactionFx(
  input: TransactionFxInput,
  baseCurrency: string,
): TransactionFx {
  if (present(input.currency) && input.currency !== baseCurrency) {
    throw new AppError("TRANSACTION_CURRENCY_MISMATCH", "交易币种必须是账本本币", 400);
  }
  const hasOriginalCurrency = present(input.originalCurrency);
  const hasOriginalAmount = present(input.originalAmountMicros);
  if (hasOriginalCurrency !== hasOriginalAmount) {
    throw new AppError("FX_ORIGINAL_INCOMPLETE", "原币种和原币金额需要同时填写", 400);
  }
  const hasToCurrency = present(input.toCurrency);
  const hasToAmount = present(input.toAmountMicros);
  if (hasToCurrency !== hasToAmount) {
    throw new AppError("FX_TO_INCOMPLETE", "转入币种和转入金额需要同时填写", 400);
  }
  if (!hasOriginalCurrency) {
    if (hasToCurrency) {
      throw new AppError(
        "FX_TO_UNEXPECTED",
        "只有转出、转入都是外币且币种不同的转账才需要填写转入金额",
        400,
      );
    }
    return NO_FX;
  }
  const originalCurrency = input.originalCurrency!;
  if (originalCurrency === baseCurrency) {
    throw new AppError("FX_ORIGINAL_IS_BASE", "原币种不能是账本本币", 400);
  }
  const originalAmountMicros = BigInt(input.originalAmountMicros!);
  if (originalAmountMicros <= 0n) {
    throw new AppError("FX_AMOUNT_INVALID", "原币金额必须大于 0", 400);
  }
  if (!hasToCurrency) {
    return { originalCurrency, originalAmountMicros, toCurrency: null, toAmountMicros: null };
  }
  const toCurrency = input.toCurrency!;
  const toAmountMicros = BigInt(input.toAmountMicros!);
  if (input.type !== "transfer" || toCurrency === baseCurrency || toCurrency === originalCurrency) {
    throw new AppError(
      "FX_TO_UNEXPECTED",
      "只有转出、转入都是外币且币种不同的转账才需要填写转入金额",
      400,
    );
  }
  if (toAmountMicros <= 0n) {
    throw new AppError("FX_AMOUNT_INVALID", "原币金额必须大于 0", 400);
  }
  return { originalCurrency, originalAmountMicros, toCurrency, toAmountMicros };
}

/**
 * 一笔交易落到某个账户上的金额（账户币种）。
 * 规则：账户是本币 → gross；等于原币种 → 原币金额；转账转入侧等于 to 币种 → to 金额；否则报错。
 */
export function sideAmount(
  fx: TransactionFx,
  baseCurrency: string,
  grossAmountMicros: bigint,
  accountCurrency: string,
  side: "account" | "from" | "to",
): bigint {
  if (accountCurrency === baseCurrency) return grossAmountMicros;
  if (side === "to" && fx.toCurrency && accountCurrency === fx.toCurrency) {
    return fx.toAmountMicros!;
  }
  if (fx.originalCurrency === accountCurrency) {
    // USD→HKD 这种两侧都外币的转账，原币是转出侧；转入侧必须走 to_*，不能也拿原币金额。
    if (side === "to" && fx.toCurrency) {
      throw new AppError("FX_ACCOUNT_CURRENCY_MISMATCH", "账户币种与记账币种不一致", 400);
    }
    return fx.originalAmountMicros!;
  }
  throw new AppError("FX_ACCOUNT_CURRENCY_MISMATCH", "账户币种与记账币种不一致", 400);
}

/**
 * 转账的币种组合校验：原币必须是某一侧账户的币种；带 to_* 时原币是转出侧、to 是转入侧。
 * 返回两侧落账金额。
 */
export function transferAmounts(
  fx: TransactionFx,
  baseCurrency: string,
  grossAmountMicros: bigint,
  fromCurrency: string,
  toCurrency: string,
): { fromAmountMicros: bigint; toAmountMicros: bigint } {
  if (fx.originalCurrency) {
    const touches = fx.originalCurrency === fromCurrency || fx.originalCurrency === toCurrency;
    if (!touches) {
      throw new AppError(
        "FX_TRANSFER_ORIGINAL_MISMATCH",
        "转账的原币种必须是转出或转入账户的币种",
        400,
      );
    }
    if (fx.toCurrency && (fx.originalCurrency !== fromCurrency || fx.toCurrency !== toCurrency)) {
      throw new AppError("FX_ACCOUNT_CURRENCY_MISMATCH", "账户币种与记账币种不一致", 400);
    }
  }
  return {
    fromAmountMicros: sideAmount(fx, baseCurrency, grossAmountMicros, fromCurrency, "from"),
    toAmountMicros: sideAmount(fx, baseCurrency, grossAmountMicros, toCurrency, "to"),
  };
}

/** 把已存的交易行还原成 DTO 里的币种字段（批量修改重建输入用）。 */
export function fxToDto(row: {
  originalCurrency: string | null;
  originalAmountMicros: bigint | null;
  toCurrency: string | null;
  toAmountMicros: bigint | null;
}): Pick<
  TransactionFxInput,
  "originalCurrency" | "originalAmountMicros" | "toCurrency" | "toAmountMicros"
> {
  return {
    originalCurrency: row.originalCurrency ?? undefined,
    originalAmountMicros: row.originalAmountMicros?.toString() ?? undefined,
    toCurrency: row.toCurrency ?? undefined,
    toAmountMicros: row.toAmountMicros?.toString() ?? undefined,
  };
}
