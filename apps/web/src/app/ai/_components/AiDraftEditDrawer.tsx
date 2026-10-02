"use client";

import { BottomSheet } from "@/components/ui";
import type { AiCard, TransactionDetail } from "@/lib/api";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { NewBillFormScreen } from "../../bills/_components/NewBillFormScreen";
import { originalAmount, useCardCurrency } from "./AiCards";

type DraftCard = Extract<AiCard, { kind: "transaction_draft" }>;

/**
 * 草稿编辑抽屉：以草稿为初值打开完整的「记一笔」表单（含关联、附件、保险/物品/订阅），
 * 全屏抽屉、不切路由。这些字段草稿存不下，所以保存即入账：幂等键与卡片「入账」共用，
 * 由调用方在 onSaved 里回写卡片状态。
 */
export function AiDraftEditDrawer({
  card,
  editKey,
  idempotencyKey,
  onClose,
  onSaved,
  open,
}: {
  card: DraftCard | null;
  /** 正在编辑的草稿标识（消息 id + 下标）：换一笔时表单要按新草稿重新初始化。 */
  editKey: string;
  onClose: () => void;
  /** 与卡片直接入账相同的幂等键，两条路径不会重复入账。 */
  idempotencyKey: string;
  /** 交易已创建：回写卡片为已入账并关闭抽屉。 */
  onSaved: (transaction: TransactionDetail) => Promise<void>;
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
          completeAfterSave
          embedded
          idempotencyKeyOverride={idempotencyKey}
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
          onSaved={onSaved}
          quickTemplates={false}
          title="编辑并入账"
        />
      ) : null}
    </BottomSheet>
  );
}
