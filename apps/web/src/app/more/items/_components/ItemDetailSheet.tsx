"use client";

import { Archive, ChevronRight, Edit3, RotateCcw, Trash2 } from "lucide-react";
import { AttachmentPreview, LoadingState, type AttachmentItem } from "@/components/business";
import { Button } from "@/components/ui";
import {
  type AttachmentRecord,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  type ItemType,
  ledgerApiPath,
} from "@/lib/api";
import { useAttachments, useItem } from "@/lib/data/records";
import { useSheetStack, useToast } from "@/providers";
import { ItemTransactionList } from "./ItemTransactionList";
import {
  consumablesFromTransactions,
  formatAverage,
  formatDateLabel,
  formatFixed1,
  formatMoney,
  itemStatus,
  itemTotalMicros,
  itemUsedMonths,
  itemUsedYears,
  typeGlyph,
} from "./item-utils";

type ItemDetailSheetProps = {
  itemId: string;
  itemTypes: ItemType[];
  ledgerId: string;
  onDelete: () => void;
  onEdit: () => void;
  onRestore: () => void;
  onScrap: () => void;
  restoring?: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  reached: "bg-[rgba(31,138,91,0.12)] text-[var(--color-accent-income)]",
  scrapped: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

function toAttachmentItem(attachment: AttachmentRecord): AttachmentItem {
  return {
    contentType: attachment.file?.mime,
    id: attachment.id,
    name: attachment.file?.originalName ?? `附件 ${attachment.id.slice(0, 6)}`,
    sizeBytes: attachment.file?.sizeBytes ? Number(attachment.file.sizeBytes) : undefined,
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex-1 text-[15px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="min-w-0 max-w-[62%] truncate text-right text-[15px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
      <div className="text-[11px] font-medium text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

export function ItemDetailSheet({
  itemId,
  itemTypes,
  ledgerId,
  onDelete,
  onEdit,
  onRestore,
  onScrap,
  restoring = false,
}: ItemDetailSheetProps) {
  const { showToast } = useToast();
  const { push } = useSheetStack();
  const detailQuery = useItem(ledgerId, itemId);
  const attachmentsQuery = useAttachments(ledgerId, "item", itemId);
  const item = detailQuery.data;

  if (!item) {
    return <LoadingState rows={5} title="加载物品" />;
  }

  const type = itemTypes.find((entry) => entry.id === item.typeId);
  const typeName = type?.name ?? "其他";
  const status = itemStatus(item);
  const consumableTransactionIds = new Set(
    item.transactionLinks
      .filter((link) => link.linkKind === "consumable")
      .map((link) => link.transactionId),
  );
  const consumables = consumablesFromTransactions(
    item.linkedTransactions.filter((transaction) => consumableTransactionIds.has(transaction.id)),
  );
  const total = itemTotalMicros(item, consumables);
  const usedYears = itemUsedYears(item);
  const usedMonths = itemUsedMonths(item);
  const hasPurchaseDate = Boolean(item.purchaseDate);
  const expected = Number(item.expectedYears ?? 0);
  const linked = item.linkedTransactions;
  const attachmentItems = (attachmentsQuery.data ?? []).map((attachment) =>
    toAttachmentItem(attachment),
  );

  const openLinkedTransactions = () => {
    push({
      title: "关联记账",
      content: (
        <ItemTransactionList
          emptyText="还没有关联的记账，记账时打开「关联物品」即可归入此物品"
          ledgerId={ledgerId}
          transactionLinks={item.transactionLinks}
          transactions={linked}
        />
      ),
    });
  };

  async function openAttachment(attachment: AttachmentItem): Promise<string | void> {
    if (attachment.url) {
      return attachment.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId, `/attachments/${attachment.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "附件暂时无法预览") });
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-2 flex-1">
      <div className="flex items-center gap-3 rounded-[22px] bg-[var(--color-bg-surface)] p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--color-control-fill-muted)] text-[26px]">
          {typeGlyph(type)}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[19px] text-[var(--color-text-primary)]">
            {item.name}
          </strong>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--color-text-muted)]">
            {typeName}
            {hasPurchaseDate ? ` · 购于 ${formatDateLabel(item.purchaseDate)}` : ""}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status.tone]}`}
        >
          {status.label}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <StatCell label="总价" value={formatMoney(total)} />
        <StatCell label="购买价格" value={formatMoney(item.purchasePriceMicros ?? "0")} />
        <StatCell
          label="平均年价"
          value={hasPurchaseDate ? formatAverage(total, usedYears) : "—"}
        />
        <StatCell
          label="平均月价"
          value={hasPurchaseDate ? formatAverage(total, usedMonths) : "—"}
        />
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
          物品信息
        </h3>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
          <DetailRow label="类型" value={typeName} />
          <DetailRow label="购买价格" value={formatMoney(item.purchasePriceMicros ?? "0")} />
          <DetailRow
            label="购买日期"
            value={hasPurchaseDate ? formatDateLabel(item.purchaseDate) : "未设置"}
          />
          <DetailRow
            label="预用年限"
            value={expected > 0 ? `${formatFixed1(expected)} 年` : "未设置"}
          />
          <DetailRow
            label="使用年份"
            value={hasPurchaseDate ? `${formatFixed1(usedYears)} 年` : "—"}
          />
          <DetailRow
            label="使用月份"
            value={hasPurchaseDate ? `${formatFixed1(usedMonths)} 个月` : "—"}
          />
          <DetailRow label="耗材总价" value={formatMoney(consumables)} />
          <DetailRow
            label="到达年限"
            value={expected > 0 ? (usedYears >= expected ? "已到达" : "未到达") : "未设预用年限"}
          />
          {item.scrappedAt ? (
            <>
              <DetailRow label="报废日期" value={formatDateLabel(item.scrapDate)} />
              <DetailRow
                label="出售价格"
                value={item.sellPriceMicros ? formatMoney(item.sellPriceMicros) : "未填写"}
              />
            </>
          ) : null}
        </div>
      </section>

      {item.note ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            备注
          </h3>
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {item.note}
          </div>
        </section>
      ) : null}

      {attachmentItems.length > 0 ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            附件 · {attachmentItems.length} 个
          </h3>
          <AttachmentPreview items={attachmentItems} onOpen={openAttachment} variant="grid" />
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
          关联记账
        </h3>
        <button
          className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
          onClick={openLinkedTransactions}
          type="button"
        >
          <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
            关联记账
            {linked.length > 0 ? (
              <span className="ml-2 text-[13px] text-[var(--color-text-muted)]">
                耗材 {formatMoney(consumables)}
              </span>
            ) : null}
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text-secondary)]">
            {linked.length} 条
          </span>
          <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
        </button>
      </section>

      <div className="mt-2 flex flex-col gap-2">
        <Button
          className="!bg-[var(--color-bg-surface)]"
          icon={<Edit3 size={17} />}
          onClick={onEdit}
          variant="secondary"
        >
          编辑物品
        </Button>
        {item.scrappedAt ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={restoring}
            icon={<RotateCcw size={17} />}
            onClick={onRestore}
            variant="secondary"
          >
            {restoring ? "处理中…" : "恢复在用"}
          </Button>
        ) : (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            icon={<Archive size={17} />}
            onClick={onScrap}
            variant="secondary"
          >
            报废或出售
          </Button>
        )}
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          icon={<Trash2 size={17} />}
          onClick={onDelete}
          variant="danger"
        >
          删除物品
        </Button>
      </div>
    </div>
  );
}
