import type { AiDraftFields } from "../ai/ai-cards";
import type { CreateTransactionDto } from "../transactions/dto/create-transaction.dto";

/**
 * 记账草稿卡 → 建交易入参。服务端版本。
 *
 * Web 端有一份等价映射（`AiScreen.tsx` 里的 `draftToTransactionInput`），两边刻意重复：
 * 把 web 的 `TransactionInput` 类型引到后端会污染类型边界。
 * 若将来出现第三个调用方（iOS 捷径等），再考虑下沉到 `packages/shared`。
 *
 * 注意只透传草稿里确实存在的字段——DTO 开了 `forbidNonWhitelisted`，
 * 显式传 undefined 与不传在 class-validator 下行为一致，但保持对象干净便于排查。
 */
export function draftToCreateTransaction(draft: AiDraftFields): CreateTransactionDto {
  return {
    type: draft.type,
    grossAmountMicros: draft.grossAmountMicros,
    occurredOn: draft.occurredOn,
    ...(draft.currency ? { currency: draft.currency } : {}),
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(draft.subcategoryId ? { subcategoryId: draft.subcategoryId } : {}),
    ...(draft.personId ? { personId: draft.personId } : {}),
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    ...(draft.subAccountId ? { subAccountId: draft.subAccountId } : {}),
    ...(draft.fromAccountId ? { fromAccountId: draft.fromAccountId } : {}),
    ...(draft.fromSubAccountId ? { fromSubAccountId: draft.fromSubAccountId } : {}),
    ...(draft.toAccountId ? { toAccountId: draft.toAccountId } : {}),
    ...(draft.toSubAccountId ? { toSubAccountId: draft.toSubAccountId } : {}),
    ...(draft.note ? { note: draft.note } : {}),
  } as CreateTransactionDto;
}

/** 与 Web 端 `aiCardIdempotencyKey` 完全一致：飞书点一次、Web 再点一次也不会重复入账。 */
export function aiCardIdempotencyKey(messageId: string, cardIndex: number): string {
  return `ai-card-${messageId}-${cardIndex}`;
}
