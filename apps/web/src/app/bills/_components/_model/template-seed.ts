import type { QuickTemplate } from "@/lib/api";
import type { TransactionSeed } from "./useTransactionFormModel";

/**
 * 快捷模板 → 表单 seed。
 * 模板列表已带齐预填所需字段，直接构建 seed，省掉选择后再请求 /prefill 的那次 loading。
 * 注意：不设置 occurredOn，由调用方决定是保留用户当前已选日期还是回到今天。
 */
export function templateToSeed(template: QuickTemplate): TransactionSeed {
  return {
    type: template.type,
    grossAmountMicros: template.amountMicros,
    categoryId: template.categoryId,
    subcategoryId: template.subcategoryId,
    personId: template.personId,
    accountId: template.accountId,
    subAccountId: template.subAccountId,
    fromAccountId: template.fromAccountId,
    fromSubAccountId: template.fromSubAccountId,
    toAccountId: template.toAccountId,
    toSubAccountId: template.toSubAccountId,
    note: template.note,
    relations: template.relationPayload,
    insuranceId: template.insuranceId,
    itemId: template.itemId,
    itemLinkKind: template.itemLinkKind,
    subscriptionId: template.subscriptionId,
  };
}
