import type { TransformFnParams } from "class-transformer";
import { Prisma } from "@fin-nest/db";

/**
 * 查询串里的 id 列表：既接受重复参数（ids=a&ids=b），也接受逗号分隔（ids=a,b）。
 * 空列表归一成 undefined，让 `@IsOptional()` 直接跳过校验。
 */
export function toIdList({ value }: TransformFnParams): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const ids = (Array.isArray(value) ? value : [value])
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

export type CategoryFilterQuery = {
  categoryId?: string;
  subcategoryId?: string;
  categoryIds?: string[];
  subcategoryIds?: string[];
};

/**
 * 分类筛选条件（调用方自行 AND 进 where）。
 *
 * 多选参数 categoryIds / subcategoryIds 之间取并集：勾一级命中该一级下的全部交易，
 * 勾二级只命中该二级，二者可混选。单选参数 categoryId / subcategoryId 保留原有的
 * 「同时满足」语义——统计页下钻靠它精确定位某个一级 + 二级组合。
 */
export function categoryWhereFilters(query: CategoryFilterQuery): Prisma.TransactionWhereInput[] {
  const filters: Prisma.TransactionWhereInput[] = [];
  if (query.categoryId) filters.push({ categoryId: query.categoryId });
  if (query.subcategoryId) filters.push({ subcategoryId: query.subcategoryId });

  const anyOf: Prisma.TransactionWhereInput[] = [];
  if (query.categoryIds?.length) anyOf.push({ categoryId: { in: query.categoryIds } });
  if (query.subcategoryIds?.length) anyOf.push({ subcategoryId: { in: query.subcategoryIds } });
  if (anyOf.length > 0) filters.push({ OR: anyOf });

  return filters;
}

/** 单选参数并入多选列表并去重；两者语义一致（都是「命中其一」），合并成一次 IN 查询。 */
export function mergeIdFilter(single?: string, many?: string[]): string[] {
  return [...new Set([...(many ?? []), ...(single ? [single] : [])])];
}

export type AccountFilterQuery = {
  accountId?: string;
  subAccountId?: string;
  accountIds?: string[];
  subAccountIds?: string[];
};

/**
 * 需要连带查「关联流水」的账户 id：只有整账户筛选才算。
 * 选到具体子账户时不带关联（关联挂在账户上，没有子账户维度），与原单选行为一致。
 */
export function accountIdsNeedingRelations(query: AccountFilterQuery): string[] {
  if (query.accountIds?.length) return query.accountIds;
  if (query.accountId && !query.subAccountId) return [query.accountId];
  return [];
}

/**
 * 账户筛选条件（调用方自行 AND 进 where）。命中出账 / 入账 / 转账两侧任一即可。
 *
 * `relationTransactionIds` 由 {@link accountIdsNeedingRelations} 的结果查出，用来把
 * 「可收回 / 需归还」关联到该账户的交易也算进来。
 */
export function accountWhereFilters(
  query: AccountFilterQuery,
  relationTransactionIds: string[],
): Prisma.TransactionWhereInput[] {
  const filters: Prisma.TransactionWhereInput[] = [];

  // 单选同时给了账户与子账户时保留配对语义：两者必须命中同一侧（AI 工具等直接调 API 的场景）。
  if (query.accountId && query.subAccountId) {
    const { accountId, subAccountId } = query;
    filters.push({
      OR: [
        { accountId, subAccountId },
        { fromAccountId: accountId, fromSubAccountId: subAccountId },
        { toAccountId: accountId, toSubAccountId: subAccountId },
      ],
    });
  }

  // 其余账户条件（含多选）之间取并集。子账户 id 全局唯一且归属固定，单独按 *SubAccountId
  // 命中就等价于「与其所属账户同侧命中」，多选时无需再逐一配对。
  const accountIds = query.subAccountId
    ? (query.accountIds ?? [])
    : mergeIdFilter(query.accountId, query.accountIds);
  const subAccountIds = query.accountId
    ? (query.subAccountIds ?? [])
    : mergeIdFilter(query.subAccountId, query.subAccountIds);

  const anyOf: Prisma.TransactionWhereInput[] = [];
  if (accountIds.length > 0) {
    anyOf.push(
      { accountId: { in: accountIds } },
      { fromAccountId: { in: accountIds } },
      { toAccountId: { in: accountIds } },
    );
  }
  if (subAccountIds.length > 0) {
    anyOf.push(
      { subAccountId: { in: subAccountIds } },
      { fromSubAccountId: { in: subAccountIds } },
      { toSubAccountId: { in: subAccountIds } },
    );
  }
  if (anyOf.length > 0) {
    if (relationTransactionIds.length > 0) anyOf.push({ id: { in: relationTransactionIds } });
    filters.push({ OR: anyOf });
  }

  return filters;
}
