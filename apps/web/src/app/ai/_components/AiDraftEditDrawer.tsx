"use client";

import { BottomSheet } from "@/components/ui";
import type { AiCard, AiDraftInput } from "@/lib/api";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { NewBillFormScreen } from "../../bills/_components/NewBillFormScreen";
import type { DraftFormValue } from "../../bills/_components/_model/useTransactionFormModel";
import { originalAmount, useCardCurrency } from "./AiCards";

type DraftCard = Extract<AiCard, { kind: "transaction_draft" }>;

/** 表单草稿模式的提交值 → PATCH 草稿入参（null 一律落成「不传」）。 */
function formValueToDraftInput(value: DraftFormValue): AiDraftInput {
  const optional = (id: string | null) => id ?? undefined;
  return {
    type: value.type,
    grossAmountMicros: value.amountMicros,
    occurredOn: value.scheduledFor,
    categoryId: optional(value.categoryId),
    subcategoryId: optional(value.subcategoryId),
    personId: optional(value.personId),
    accountId: optional(value.accountId),
    subAccountId: optional(value.subAccountId),
    fromAccountId: optional(value.fromAccountId),
    fromSubAccountId: optional(value.fromSubAccountId),
    toAccountId: optional(value.toAccountId),
    toSubAccountId: optional(value.toSubAccountId),
    note: value.note || undefined,
  };
}

/**
 * 草稿编辑抽屉：直接复用「记一笔」的完整表单（支出/收入/转账、分类、账户、人员、备注），
 * 以全屏抽屉打开、不切路由；保存只修改草稿内容，入账仍在卡片上确认。
 */
export function AiDraftEditDrawer({
  card,
  editKey,
  onClose,
  onSave,
  open,
}: {
  card: DraftCard | null;
  /** 正在编辑的草稿标识（消息 id + 下标）：换一笔时表单要按新草稿重新初始化。 */
  editKey: string;
  onClose: () => void;
  onSave: (draft: AiDraftInput) => Promise<void>;
  open: boolean;
}) {
  const isDesktop = useIsDesktop();
  const currency = useCardCurrency(card?.draft.currency);
  const notices: Array<{ text: string; warn?: boolean }> = [];
  if (card?.possibleDuplicate) {
    notices.push({
      warn: true,
      text: `当天账本里已有一笔相同金额${
        card.possibleDuplicate.note ? `（${card.possibleDuplicate.note}）` : ""
      }，确认不是重复再入账`,
    });
  }
  if (card?.originalAmountMicros) {
    notices.push({
      text: `图上原金额 ${originalAmount(card.originalAmountMicros, currency)}，已按账本精度四舍五入`,
    });
  }

  return (
    <BottomSheet
      className={
        isDesktop
          ? "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form"
          : "ui-bottom-sheet--sheet-form ui-bottom-sheet--full-height"
      }
      hideDefaultHeader
      onClose={onClose}
      open={open && card !== null}
    >
      {card ? (
        <NewBillFormScreen
          embedded
          key={editKey}
          initialSeed={card.draft}
          notice={
            notices.length > 0 ? (
              <div className="ai-draft-drawer__notices">
                {notices.map((notice) => (
                  <p
                    className={
                      notice.warn ? "ai-batch__notice ai-batch__notice--warn" : "ai-batch__notice"
                    }
                    key={notice.text}
                  >
                    {notice.text}
                  </p>
                ))}
              </div>
            ) : null
          }
          onClose={onClose}
          onSubmitDraft={async (value) => {
            await onSave(formValueToDraftInput(value));
            onClose();
          }}
          title="编辑草稿"
        />
      ) : null}
    </BottomSheet>
  );
}
