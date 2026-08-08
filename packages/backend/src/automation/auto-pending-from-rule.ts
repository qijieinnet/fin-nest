import { Prisma } from "@fin-nest/db";

/**
 * 自动记账规则 → 待确认记录的字段搬运。
 *
 * 单独抽出来是因为漏一个字段的后果太隐蔽：待确认照样生成、照样能确认入账，只是关联悄悄没了
 * （`subscription_id` 就这么漏过一次，导致确认后的交易没有订阅关联、续订也不会自动确认）。
 * 搬运清单由 DMMF 现算而不是手写，配合 `autoRuleCarriedFields` 的测试，
 * 以后往两张表同时加列时漏搬会直接把测试跑红。
 */

/** 显式排除的系统列：不是业务快照，由调用方或数据库自己给值。 */
const SYSTEM_FIELDS = new Set(["id", "ledgerId", "createdAt", "updatedAt", "updatedBy"]);

function scalarFieldNames(model: string): string[] {
  const found = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model);
  if (!found) throw new Error(`未知的 Prisma 模型：${model}`);
  return found.fields
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => field.name);
}

/**
 * 规则必须整份带进待确认的业务字段：两张表**同名同义**的标量列，去掉系统列。
 *
 * 「同名即同义」在这两张表上成立（待确认就是规则在某个周期的快照），因此新增业务列只要
 * 两边都加就会自动进入清单；只属于其中一张表的列（`repeatRule` / `status` 等）天然不在交集里。
 */
export function autoRuleCarriedFields(): string[] {
  const pendingFields = new Set(scalarFieldNames("AutoPendingTransaction"));
  return scalarFieldNames("AutoRule").filter(
    (name) => pendingFields.has(name) && !SYSTEM_FIELDS.has(name),
  );
}

export type AutoRuleSnapshotSource = Prisma.AutoRuleGetPayload<Record<string, never>>;

/** 一期待确认的「非规则」部分：哪一期、计划哪天入账。 */
export type AutoPendingPeriod = {
  periodKey: string;
  scheduledFor: Date;
};

/** 建待确认时除 `ledgerId` / `autoRuleId` 外的全部字段。 */
export type AutoPendingSnapshotData = Omit<
  Prisma.AutoPendingTransactionUncheckedCreateInput,
  "id" | "ledgerId" | "autoRuleId" | "createdAt" | "updatedAt" | "updatedBy"
>;

/**
 * 按 `autoRuleCarriedFields()` 把规则的业务字段整份复制出来，附上这一期的周期键与计划入账日。
 *
 * `relationPayload` 为空要写 `Prisma.JsonNull`：JSON 列上的 `null` 在 Prisma 里有歧义，直接传
 * `null` 过不了类型。
 */
export function autoPendingDataFromRule(
  rule: AutoRuleSnapshotSource,
  period: AutoPendingPeriod,
): AutoPendingSnapshotData {
  const source = rule as unknown as Record<string, unknown>;
  const carried: Record<string, unknown> = {};
  for (const field of autoRuleCarriedFields()) {
    const value = source[field];
    carried[field] =
      field === "relationPayload" && (value === null || value === undefined)
        ? Prisma.JsonNull
        : (value ?? null);
  }
  // 逐字段动态搬运换不到静态类型，这一处断言由 autoRuleCarriedFields 的字段齐全性测试兜底。
  return {
    ...carried,
    periodKey: period.periodKey,
    scheduledFor: period.scheduledFor,
    status: "pending",
  } as AutoPendingSnapshotData;
}
