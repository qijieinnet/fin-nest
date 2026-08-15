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
