/**
 * 旧格式系统备份的行级升级：恢复时把「备份时还没有、现在是必填」的列按迁移的口径补上。
 *
 * 系统备份按 Prisma DMMF 现算表结构，升级后恢复升级前的备份时，新加的 NOT NULL 列会缺值，
 * createMany 直接失败——旧备份就再也恢复不了。每加一个这样的列，都要在这里补上与迁移相同的回填规则。
 */

export type LegacyUpgradeContext = {
  /** 已恢复的账本 id → 本币（恢复按外键拓扑顺序，ledgers 一定先于 accounts）。 */
  ledgerCurrency: ReadonlyMap<string, string>;
};

/** 需要升级上下文的表；restoreTable 据此决定要不要先查一次账本币种。 */
export const LEGACY_UPGRADE_TABLES: ReadonlySet<string> = new Set(["accounts"]);

export function upgradeLegacyRow(
  table: string,
  row: Record<string, unknown>,
  context: LegacyUpgradeContext,
): void {
  // 56_multi_currency：accounts.currency 回填为所属账本本币（迁移里同样的规则，兜底 CNY）。
  if (table === "accounts" && (row.currency === undefined || row.currency === null)) {
    const ledgerId = typeof row.ledgerId === "string" ? row.ledgerId : "";
    row.currency = context.ledgerCurrency.get(ledgerId) ?? "CNY";
  }
}
