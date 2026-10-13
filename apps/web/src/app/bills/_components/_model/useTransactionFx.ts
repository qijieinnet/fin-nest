"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { convertMicros, parseFxRate } from "@fin-nest/shared";
import type { Account, FxQuote, TransactionType } from "@/lib/api";
import { useFxRate } from "@/lib/data/fx";
import { resolveAccountSelection } from "@/lib/data/options";
import { CURRENCIES, currencyDecimals, microsToInput, parseMoneyToMicros } from "@/lib/money";
import { t } from "@/lib/i18n";

/**
 * 记账表单的币种部分（docs/MULTI_CURRENCY_PLAN.md §2.1、§6「记账表单」）。
 *
 * 用户输入的「金额」是**入账币种**的金额：
 * - 收支：选了外币账户 → 只能是账户币种或本币；否则任选（默认本币）。
 * - 转账：恒为转出账户的币种。
 * 需要时再多出两个输入框：
 * - 折合本币（入账币种 ≠ 本币）：按记账日汇率自动填，用户改过就不再覆盖（照银行实际入账额记）。
 * - 另一侧金额：收支时用本币记外币账户（账户扣多少美元）；转账时转入账户币种既不是转出币种也不是本币。
 *
 * 提交时折成后端的口径：gross = 本币金额；original / to 按 transaction-fx 的规则落位。
 */

export type FxInitial = {
  grossAmountMicros?: string | null;
  originalCurrency?: string | null;
  originalAmountMicros?: string | null;
  toCurrency?: string | null;
  toAmountMicros?: string | null;
  /** 本币只是估算：回显原币后不锁定折合本币，按汇率重新算。 */
  fxRecompute?: boolean;
};

type Params = {
  ledgerId: string;
  type: TransactionType;
  accounts: Account[];
  accountsLoaded: boolean;
  accountEnabled: boolean;
  accountSel: string | null;
  fromSel: string | null;
  toSel: string | null;
  occurredOn: string;
  /** 入账币种金额（表单主金额输入框的值）。 */
  amount: string;
  setAmount: (value: string) => void;
  baseCurrency: string;
  /** 账本本币的小数位。 */
  ledgerDecimalPlaces: number;
  initial?: FxInitial | null;
};

export type FxPayload = {
  /** 本币金额输入（交给 buildPayload 当 grossAmountMicros 解析）。 */
  grossInput: string;
  fields: {
    originalCurrency?: string;
    originalAmountMicros?: string;
    toCurrency?: string;
    toAmountMicros?: string;
  };
};

function roundToPlaces(micros: bigint, places: number): bigint {
  const step = 10n ** BigInt(6 - places);
  if (step === 1n) return micros;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs * 2n + step) / (step * 2n)) * step;
  return negative ? -rounded : rounded;
}

export function useTransactionFx({
  accountEnabled,
  accountSel,
  accounts,
  accountsLoaded,
  amount,
  baseCurrency,
  fromSel,
  initial,
  ledgerDecimalPlaces,
  ledgerId,
  occurredOn,
  setAmount,
  toSel,
  type,
}: Params) {
  const currencyOfSel = (selection: string | null): string | null => {
    const resolved = resolveAccountSelection(accounts, selection);
    if (!resolved.accountId) return null;
    return accounts.find((account) => account.id === resolved.accountId)?.currency ?? baseCurrency;
  };
  const accountCurrency = type !== "transfer" && accountEnabled ? currencyOfSel(accountSel) : null;
  const fromCurrency = type === "transfer" ? (currencyOfSel(fromSel) ?? baseCurrency) : null;
  const toCurrency = type === "transfer" ? (currencyOfSel(toSel) ?? baseCurrency) : null;

  const [chosenCurrency, setChosenCurrency] = useState(baseCurrency);
  const [baseAmount, setBaseAmountRaw] = useState("");
  const [baseTouched, setBaseTouched] = useState(false);
  const [sideAmount, setSideAmountRaw] = useState("");
  const [sideTouched, setSideTouched] = useState(false);

  const allCodes = useMemo(() => CURRENCIES.map((currency) => currency.code), []);
  const currencyOptions: string[] =
    type === "transfer"
      ? [fromCurrency!]
      : accountCurrency && accountCurrency !== baseCurrency
        ? [accountCurrency, baseCurrency]
        : allCodes;
  const entryCurrency =
    type === "transfer"
      ? fromCurrency!
      : currencyOptions.includes(chosenCurrency)
        ? chosenCurrency
        : currencyOptions[0]!;
  const entryDecimalPlaces =
    entryCurrency === baseCurrency ? ledgerDecimalPlaces : currencyDecimals(entryCurrency);
  const showBase = entryCurrency !== baseCurrency;
  const sideCurrency =
    type === "transfer"
      ? toCurrency !== entryCurrency && toCurrency !== baseCurrency
        ? toCurrency
        : null
      : accountCurrency && accountCurrency !== baseCurrency && accountCurrency !== entryCurrency
        ? accountCurrency
        : null;
  const sideDecimalPlaces = sideCurrency ? currencyDecimals(sideCurrency) : 2;

  // ---- 编辑 / 待确认 / 预填：账户加载后按交易已有的币种字段回显一次 ----
  const initDone = useRef(false);
  // 上一次看到的各账户币种：用来区分「用户换了账户」与「账户数据加载完成 / 回显」。
  // 在初始化那一刻对齐成当时的值，之后的变化才算用户操作。
  const lastAccountCurrency = useRef(accountCurrency);
  const lastFromCurrency = useRef(fromCurrency);
  const lastToCurrency = useRef(toCurrency);
  // 回显时写进去的金额：它落地的那次变化不算用户修改。之后金额再变（$10 → $20）
  // 就是用户改的，折算值要跟着重算，否则会拿着旧的本币金额提交。
  const hydratedAmount = useRef<string | null>(null);
  // 回显所在的那次提交里，下面的自动折算 effect 读到的还是回显前的状态（touched=false、旧金额），
  // 会把刚写进去的已存金额覆盖掉：这一轮一律跳过，由最后一个 effect 清掉标记。
  const justHydrated = useRef(false);
  // 跳过之后要保证还有下一次渲染让自动折算 effect 重跑：回显可能没改变任何 state
  // （比如模板的本币估算与原币文本恰好相同），只清 ref 不会触发重跑，折合值就永远空着。
  const [hydrationTick, setHydrationTick] = useState(0);
  // 模板「本币转出、外币转入」：外币转入额是准的，本币转出额要按当天「外币→本币」汇率反推。
  const [recomputeFromSide, setRecomputeFromSide] = useState<{
    currency: string;
    micros: bigint;
    /** 回显时放进去的估算值：当前金额不再是它，就说明用户改过，不能再反推覆盖。 */
    estimateText: string;
  } | null>(null);
  const hydrateAmount = (text: string) => {
    hydratedAmount.current = text;
    setAmount(text);
  };
  useEffect(() => {
    if (initDone.current || !accountsLoaded) return;
    initDone.current = true;
    lastAccountCurrency.current = accountCurrency;
    lastFromCurrency.current = fromCurrency;
    lastToCurrency.current = toCurrency;
    const original = initial?.originalCurrency;
    if (!initial || !original || !initial.originalAmountMicros) return;
    justHydrated.current = true;
    setHydrationTick((tick) => tick + 1);
    const fmt = (micros: string | null | undefined, places: number) =>
      microsToInput(micros, { decimalPlaces: places, omitZeroFraction: false });
    const grossText = fmt(initial.grossAmountMicros, ledgerDecimalPlaces);
    const originalText = fmt(initial.originalAmountMicros, currencyDecimals(original));
    if (type === "transfer") {
      const from = currencyOfSel(fromSel) ?? baseCurrency;
      if (from === baseCurrency) {
        // 本币转出、外币转入：原币是转入侧。
        setSideAmountRaw(originalText);
        setSideTouched(true);
        if (initial.fxRecompute) {
          // 本币只是估算：先放估算值占位，取到汇率后按原币反推（见下方 recomputeFromSide）。
          hydrateAmount(grossText);
          setRecomputeFromSide({
            currency: original,
            micros: BigInt(initial.originalAmountMicros),
            estimateText: grossText,
          });
          return;
        }
        hydrateAmount(grossText);
        return;
      }
      hydrateAmount(originalText);
      if (!initial.fxRecompute) {
        setBaseAmountRaw(grossText);
        setBaseTouched(true);
      }
      if (initial.toCurrency && initial.toAmountMicros) {
        setSideAmountRaw(fmt(initial.toAmountMicros, currencyDecimals(initial.toCurrency)));
        setSideTouched(true);
      }
      return;
    }
    const account = accountEnabled ? currencyOfSel(accountSel) : null;
    // 本币记在外币账户上（比如「从美元卡扣了 ¥70」）的情况在回显时统一按原币展示：
    // 金额 = 原币，折合本币 = gross，两种入法存下来的数据完全一样。
    setChosenCurrency(account && account !== baseCurrency ? account : original);
    hydrateAmount(originalText);
    if (initial.fxRecompute) return;
    setBaseAmountRaw(grossText);
    setBaseTouched(true);
  }, [accountsLoaded]);

  // 用户换了账户（收支账户、转出、转入）：
  // - 选了外币账户时入账币种默认跟到账户币种（$20 的美元卡消费最常见），用户仍可切回本币；
  // - 之前手改过的折算值对不上新账户了，恢复自动折算。
  // 只认初始化之后的变化：账户数据加载、编辑回显都不算，否则会把已存的实际入账金额冲掉。
  useEffect(() => {
    if (!initDone.current) return;
    const accountChanged = accountCurrency !== lastAccountCurrency.current;
    const transferChanged =
      fromCurrency !== lastFromCurrency.current || toCurrency !== lastToCurrency.current;
    if (!accountChanged && !transferChanged) return;
    lastAccountCurrency.current = accountCurrency;
    lastFromCurrency.current = fromCurrency;
    lastToCurrency.current = toCurrency;
    if (accountChanged && accountCurrency && accountCurrency !== baseCurrency) {
      setChosenCurrency(accountCurrency);
    }
    setBaseTouched(false);
    setSideTouched(false);
    // 换了账户，模板那笔待执行的反推不再对应当前表单。
    setRecomputeFromSide(null);
  }, [accountCurrency, baseCurrency, fromCurrency, toCurrency]);

  // ---- 汇率与自动折算 ----
  const baseRateQuery = useFxRate(
    ledgerId,
    showBase ? entryCurrency : null,
    baseCurrency,
    occurredOn,
  );
  const sideRateQuery = useFxRate(
    ledgerId,
    sideCurrency ? entryCurrency : null,
    sideCurrency,
    occurredOn,
  );
  const baseQuote: FxQuote | null = baseRateQuery.data ?? null;
  const reverseRateQuery = useFxRate(
    ledgerId,
    recomputeFromSide ? recomputeFromSide.currency : null,
    baseCurrency,
    occurredOn,
  );
  useEffect(() => {
    if (!recomputeFromSide) return;
    // 直接看这一帧渲染出来的金额，而不是等「金额变化」的 effect 来取消：两者可能落在同一次提交里，
    // 那时取消来得太晚，已经调用的 setAmount 撤不回来。
    // 同理核对转账方向：本币转出、转入币种仍是模板那一个，否则（换了账户/类型）反推已不成立。
    const stillApplies =
      amount === recomputeFromSide.estimateText &&
      type === "transfer" &&
      fromCurrency === baseCurrency &&
      toCurrency === recomputeFromSide.currency;
    if (!stillApplies) {
      setRecomputeFromSide(null);
      return;
    }
    const rate = reverseRateQuery.data ? parseFxRate(reverseRateQuery.data.rate) : null;
    if (!rate) {
      // 取不到汇率就保留估算值（与直接记账「取不到就用估算」一致），用户可以手改。
      if (!reverseRateQuery.isFetching) setRecomputeFromSide(null);
      return;
    }
    const base = roundToPlaces(convertMicros(recomputeFromSide.micros, rate), ledgerDecimalPlaces);
    hydrateAmount(
      microsToInput(base, { decimalPlaces: ledgerDecimalPlaces, omitZeroFraction: false }),
    );
    setRecomputeFromSide(null);
  }, [
    amount,
    baseCurrency,
    fromCurrency,
    recomputeFromSide,
    reverseRateQuery.data,
    reverseRateQuery.isFetching,
    toCurrency,
    type,
  ]);
  const sideQuote: FxQuote | null = sideRateQuery.data ?? null;

  const parsedEntry = parseMoneyToMicros(amount, { decimalPlaces: entryDecimalPlaces });
  const entryMicros =
    parsedEntry.ok && parsedEntry.amountMicros ? BigInt(parsedEntry.amountMicros) : null;

  const convertWith = (quote: FxQuote | null, places: number): string | null => {
    if (!quote || entryMicros === null) return null;
    const rate = parseFxRate(quote.rate);
    if (!rate) return null;
    return microsToInput(roundToPlaces(convertMicros(entryMicros, rate), places), {
      decimalPlaces: places,
      omitZeroFraction: false,
    });
  };
  const suggestedBase = showBase ? convertWith(baseQuote, ledgerDecimalPlaces) : null;
  const suggestedSide = sideCurrency ? convertWith(sideQuote, sideDecimalPlaces) : null;

  useEffect(() => {
    if (justHydrated.current || !showBase || baseTouched) return;
    setBaseAmountRaw(suggestedBase ?? "");
  }, [baseTouched, showBase, suggestedBase, hydrationTick]);
  useEffect(() => {
    if (justHydrated.current || !sideCurrency || sideTouched) return;
    setSideAmountRaw(suggestedSide ?? "");
  }, [sideCurrency, sideTouched, suggestedSide, hydrationTick]);

  // 与上一次提交比较（而不是与某个时刻记下的值比较）：初始化和这个副作用可能落在同一次提交里，
  // 那时读到的还是回显前的金额，不能据此判断「用户改了金额」。
  const prevAmount = useRef(amount);
  useEffect(() => {
    const changed = amount !== prevAmount.current;
    prevAmount.current = amount;
    if (!changed || !initDone.current) return;
    if (hydratedAmount.current !== null && amount === hydratedAmount.current) {
      hydratedAmount.current = null;
      return;
    }
    hydratedAmount.current = null;
    setBaseTouched(false);
    setSideTouched(false);
    // 用户自己改了金额：迟到的汇率不能再把它覆盖成模板反推值。
    setRecomputeFromSide(null);
  }, [amount]);

  // 必须放在所有自动折算 effect 之后：同一次提交里按声明顺序执行，这里最后清标记。
  useEffect(() => {
    justHydrated.current = false;
  });

  /** 用户手动换入账币种：之前手改过的折算值不再对应，恢复自动折算。 */
  const setEntryCurrency = (currency: string) => {
    setChosenCurrency(currency);
    setBaseTouched(false);
    setSideTouched(false);
    setRecomputeFromSide(null);
  };

  const setBaseAmount = (value: string) => {
    setBaseAmountRaw(value);
    setBaseTouched(true);
  };
  const setSideAmount = (value: string) => {
    setSideAmountRaw(value);
    setSideTouched(true);
    setRecomputeFromSide(null);
  };
  const resetFx = () => {
    setRecomputeFromSide(null);
    setBaseAmountRaw("");
    setBaseTouched(false);
    setSideAmountRaw("");
    setSideTouched(false);
  };

  /** 折成后端口径；校验失败返回错误文案。 */
  const buildFx = (): { ok: true; value: FxPayload } | { ok: false; message: string } => {
    const parseIn = (value: string, places: number) => {
      const parsed = parseMoneyToMicros(value, { decimalPlaces: places });
      return parsed.ok && parsed.amountMicros && BigInt(parsed.amountMicros) > 0n
        ? parsed.amountMicros
        : null;
    };
    // 模板还在等汇率反推本币：此刻的本币只是估算，不能拿去提交。
    if (recomputeFromSide) return { ok: false, message: t("正在按汇率折算本币金额…") };
    const entry = parseIn(amount, entryDecimalPlaces);
    if (!entry) return { ok: false, message: t("请输入有效金额") };
    let grossInput = amount;
    if (showBase) {
      if (!parseIn(baseAmount, ledgerDecimalPlaces)) {
        return {
          ok: false,
          message: baseQuote
            ? t("请填写折合本币金额")
            : t("取不到 {currency} 汇率，请手动填写折合本币金额", { currency: entryCurrency }),
        };
      }
      grossInput = baseAmount;
    }
    let side: string | null = null;
    if (sideCurrency) {
      side = parseIn(sideAmount, sideDecimalPlaces);
      if (!side) {
        return {
          ok: false,
          message: t("请填写 {currency} 金额", { currency: sideCurrency }),
        };
      }
    }
    const fields: FxPayload["fields"] = {};
    if (type === "transfer") {
      if (fromCurrency !== baseCurrency) {
        fields.originalCurrency = fromCurrency!;
        fields.originalAmountMicros = entry;
        if (sideCurrency && side) {
          fields.toCurrency = sideCurrency;
          fields.toAmountMicros = side;
        }
      } else if (sideCurrency && side) {
        fields.originalCurrency = sideCurrency;
        fields.originalAmountMicros = side;
      }
    } else if (sideCurrency && side) {
      // 外币账户、按本币记：原币是账户扣的那笔外币。
      fields.originalCurrency = sideCurrency;
      fields.originalAmountMicros = side;
    } else if (entryCurrency !== baseCurrency) {
      fields.originalCurrency = entryCurrency;
      fields.originalAmountMicros = entry;
    }
    return { ok: true, value: { grossInput, fields } };
  };

  return {
    baseCurrency,
    entryCurrency,
    setEntryCurrency,
    currencyOptions,
    entryDecimalPlaces,
    showBase,
    baseAmount,
    setBaseAmount,
    baseQuote,
    baseRateLoading: showBase && baseRateQuery.isFetching,
    sideCurrency,
    sideDecimalPlaces,
    sideAmount,
    setSideAmount,
    sideQuote,
    sideLabel:
      type === "transfer" ? t("转入金额") : type === "income" ? t("账户入账") : t("账户扣款"),
    ledgerDecimalPlaces,
    buildFx,
    /** 等待汇率反推本币的模板原币（转全屏时要带过去，让全屏页继续反推）。 */
    pendingRecompute: recomputeFromSide,
    resetFx,
  };
}

export type TransactionFxModel = ReturnType<typeof useTransactionFx>;
