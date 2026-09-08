/**
 * 投资账户的本金/收益推导。
 *
 * 本金不是存出来的，是算出来的。投资账户的余额变动天然只有两类：
 *   · 现金流（opening / transfer_in / transfer_out / expense / income）→ 本金进出
 *   · 市值重估（revaluation，由「更新市值」写入）                      → 收益
 * 于是：
 *   累计收益   = Σ revaluation.amountDeltaMicros
 *   净投入本金 = 当前余额 − 累计收益
 *
 * 两个恒等式永远自洽（不会出现「转入了钱但忘了改本金」导致收益虚高），
 * 并且因为 revaluation 流水带 subAccountId，同一套推导直接适用于子账户粒度。
 */

export type InvestmentSummary = {
  /** 净投入本金 = 当前余额 − 累计收益。全部赎回后可能为负（收回多于投入）。 */
  costMicros: string;
  /** 累计收益（含未实现浮盈亏）= Σ 市值重估流水的差额。 */
  gainMicros: string;
};

/** 市值重估流水的聚合行（`groupBy(['accountId','subAccountId'])` 的结果形状）。 */
export type RevaluationSumRow = {
  accountId: string;
  subAccountId: string | null;
  _sum: { amountDeltaMicros: bigint | null };
};

export type RevaluationIndex = {
  byAccount: Map<string, bigint>;
  bySubAccount: Map<string, bigint>;
};

/**
 * 把聚合行拆成「按账户」「按子账户」两张表。
 * 账户级要把该账户下所有子账户的重估都算进去，所以两张表分别累加，不是简单转置。
 */
export function indexRevaluationSums(rows: RevaluationSumRow[]): RevaluationIndex {
  const byAccount = new Map<string, bigint>();
  const bySubAccount = new Map<string, bigint>();
  for (const row of rows) {
    const sum = row._sum.amountDeltaMicros ?? 0n;
    byAccount.set(row.accountId, (byAccount.get(row.accountId) ?? 0n) + sum);
    if (row.subAccountId) {
      bySubAccount.set(row.subAccountId, (bySubAccount.get(row.subAccountId) ?? 0n) + sum);
    }
  }
  return { byAccount, bySubAccount };
}

/** 非投资账户返回 null（前端据此决定要不要渲染本金/收益那一段）。 */
export function buildInvestmentSummary(
  accountType: string,
  balanceMicros: bigint,
  gainMicros: bigint,
): InvestmentSummary | null {
  if (accountType !== "invest") return null;
  return {
    costMicros: (balanceMicros - gainMicros).toString(),
    gainMicros: gainMicros.toString(),
  };
}
