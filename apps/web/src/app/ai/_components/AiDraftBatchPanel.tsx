"use client";

import {
  Check,
  ChevronRight,
  Minus,
  MoreHorizontal,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AccountSelectRow,
  CategorySelectRow,
  DateWheelPicker,
  SearchableOptionSelectRow,
} from "@/components/business";
import { BottomSheet, Button, IconButton, PopoverMenu, Tabs } from "@/components/ui";
import {
  getApiErrorMessage,
  type Account,
  type AiCard,
  type AiDraftFields,
  type AiDraftInput,
  type Category,
  type Person,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { categoryOptions, moneyAccountOptions, personOptions } from "@/lib/data/options";
import { amount, TYPE_COLOR, TYPE_LABEL, useCardCurrency } from "./AiCards";

type DraftCard = Extract<AiCard, { kind: "transaction_draft" }>;

export type DraftEntry = { cardIndex: number; card: DraftCard };

export type DraftPatch = { cardIndex: number; draft: AiDraftInput };

/** 草稿卡 → PATCH 入参：只带 id 字段，名称由服务端按账本数据回填。 */
export function draftToInput(draft: AiDraftFields): AiDraftInput {
  return {
    type: draft.type,
    grossAmountMicros: draft.grossAmountMicros,
    occurredOn: draft.occurredOn,
    ...(draft.occurredTime ? { occurredTime: draft.occurredTime } : {}),
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
  };
}

/** 分类选择器的选项 id（子分类优先）→ 草稿的一级/二级分类。 */
function categoryPatch(categories: Category[], optionId: string | null) {
  if (!optionId) return { categoryId: undefined, subcategoryId: undefined };
  for (const category of categories) {
    if (category.id === optionId) return { categoryId: category.id, subcategoryId: undefined };
    if (category.subcategories.some((sub) => sub.id === optionId)) {
      return { categoryId: category.id, subcategoryId: optionId };
    }
  }
  return { categoryId: undefined, subcategoryId: undefined };
}

/** 账户选择器的选项 id（简单账户为默认子账户 id）→ 草稿的账户/子账户。 */
function accountPatch(accounts: Account[], optionId: string | null) {
  if (!optionId) return { accountId: undefined, subAccountId: undefined };
  for (const account of accounts) {
    if (account.id === optionId) return { accountId: account.id, subAccountId: undefined };
    if (account.subAccounts.some((sub) => sub.id === optionId)) {
      return { accountId: account.id, subAccountId: optionId };
    }
  }
  return { accountId: undefined, subAccountId: undefined };
}

function isSelectable(card: DraftCard): boolean {
  return card.status === "proposed";
}

/** 默认勾选：能直接确认（不缺分类/账户）且不疑似重复的待确认草稿。 */
function isDefaultSelected(card: DraftCard): boolean {
  return isSelectable(card) && !card.confirmationBlockedReason && !card.possibleDuplicate;
}

/** 不可确认的原因标签：缺分类（收支没分类）/ 缺账户（卡尾号对不上，服务端没自动补账户）。 */
function blockedTag(card: DraftCard): string {
  const reason = card.confirmationBlockedReason ?? "";
  const lacksCategory = card.draft.type !== "transfer" && !card.draft.categoryId;
  const lacksAccount = reason.includes("账户");
  if (lacksCategory && lacksAccount) return "缺分类和账户";
  return lacksAccount ? "缺账户" : "缺分类";
}

/** 底部按钮的汇总说法：都缺同一样就点名，混着缺就笼统说「信息不全」。 */
function blockedText(entries: DraftEntry[]): string {
  const tags = new Set(entries.map((entry) => blockedTag(entry.card)));
  return tags.size === 1 ? [...tags][0]! : "信息不全";
}

function categoryText(draft: AiDraftFields): string | undefined {
  if (!draft.categoryName) return undefined;
  return draft.subcategoryName
    ? `${draft.categoryName} · ${draft.subcategoryName}`
    : draft.categoryName;
}

/** 账户 + 非默认子账户：同一银行下两个子账户互转时，只写账户名会变成「招行 → 招行」。 */
function accountLabel(account?: string, subAccount?: string): string {
  if (!account) return "未指定";
  return subAccount ? `${account}·${subAccount}` : account;
}

function accountText(draft: AiDraftFields): string | undefined {
  if (draft.type === "transfer") {
    return `${accountLabel(draft.fromAccountName, draft.fromSubAccountName)} → ${accountLabel(
      draft.toAccountName,
      draft.toSubAccountName,
    )}`;
  }
  if (!draft.accountName) return undefined;
  return draft.subAccountName
    ? `${draft.accountName} · ${draft.subAccountName}`
    : draft.accountName;
}

/** 批量设置人员列表里的「不修改」选项（选它即撤回已选的人员）。 */
const KEEP_PERSON = "__keep__";

/** 列表里的日期：今年省略年份。 */
function shortDate(date: string): string {
  return date.startsWith(`${new Date().getFullYear()}-`) ? date.slice(5) : date;
}

/** 选中草稿的收支合计（转账不计），用于底部「合计」提示。 */
function selectionTotals(entries: DraftEntry[]) {
  let expense = 0n;
  let income = 0n;
  for (const { card } of entries) {
    const micros = BigInt(card.draft.grossAmountMicros);
    if (card.draft.type === "expense") expense += micros;
    else if (card.draft.type === "income") income += micros;
  }
  return { expense, income };
}

/**
 * 多笔草稿的批量面板（识别账单图片 / 一句话记多笔）。
 * - 左侧圆点勾选，点行其余部分打开全屏编辑抽屉（复用记一笔表单，不切路由），
 *   不在聊天流里展开大表单；
 * - 行内只放小标签（缺分类 / 缺账户 / 疑似重复 / 已取整），细节进编辑面板看；
 * - 底部只有一个主操作「确认入账 N 笔」，批量设置与作废收进「⋯」菜单；
 * - 全部处理完后折叠成一行摘要，历史消息里不再铺一长串灰色行。
 * 每笔仍按各自的幂等键单独入账（由外层编排），某一笔失败不影响其它笔，重试也不会重复入账。
 */
export function AiDraftBatchPanel({
  entries,
  categories,
  accounts,
  people,
  disabled = false,
  busy = false,
  onConfirm,
  onVoid,
  onSave,
  onEdit,
}: {
  entries: DraftEntry[];
  categories: Category[];
  accounts: Account[];
  people: Person[];
  /** 流式生成中：消息尚未持久化，只展示不可操作。 */
  disabled?: boolean;
  /** 外层正在批量确认/作废。 */
  busy?: boolean;
  onConfirm: (cardIndexes: number[]) => void;
  onVoid: (cardIndexes: number[]) => void;
  /** 批量设置的保存；失败时 reject，由批量设置面板就地展示错误。 */
  onSave: (patches: DraftPatch[]) => Promise<void>;
  /** 打开单笔草稿的编辑抽屉（由聊天页统一持有，单卡与批量面板共用）。 */
  onEdit: (cardIndex: number) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(entries.filter((entry) => isDefaultSelected(entry.card)).map((e) => e.cardIndex)),
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settledExpanded, setSettledExpanded] = useState(false);

  // 新流入的草稿按默认规则补勾；已确认/已作废的从选中里剔除；
  // 编辑后从「缺分类/缺账户」变成可确认的，也补勾上（用户刚修好它，多半就是要记）。
  const entryKey = entries
    .map((e) => `${e.cardIndex}:${e.card.status}:${e.card.confirmationBlockedReason ? 1 : 0}`)
    .join(",");
  const [known, setKnown] = useState<Map<number, boolean>>(
    () => new Map(entries.map((e) => [e.cardIndex, Boolean(e.card.confirmationBlockedReason)])),
  );
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<number>();
      for (const entry of entries) {
        if (!isSelectable(entry.card)) continue;
        const wasBlocked = known.get(entry.cardIndex);
        const isNew = wasBlocked === undefined;
        const justFixed = wasBlocked === true && !entry.card.confirmationBlockedReason;
        if (prev.has(entry.cardIndex) || ((isNew || justFixed) && isDefaultSelected(entry.card))) {
          next.add(entry.cardIndex);
        }
      }
      return next;
    });
    setKnown(new Map(entries.map((e) => [e.cardIndex, Boolean(e.card.confirmationBlockedReason)])));
    // entryKey 概括了 entries 中影响选择的部分。
  }, [entryKey]);

  const currency = useCardCurrency(entries[0]?.card.draft.currency);
  const proposed = entries.filter((entry) => isSelectable(entry.card));
  const confirmedCount = entries.filter((entry) => entry.card.status === "confirmed").length;
  const voidedCount = entries.filter((entry) => entry.card.status === "superseded").length;
  const selectedEntries = proposed.filter((entry) => selected.has(entry.cardIndex));
  const blockedSelected = selectedEntries.filter((entry) => entry.card.confirmationBlockedReason);
  const allSelected = proposed.length > 0 && selectedEntries.length === proposed.length;
  const interactive = !disabled && !busy;
  const settled = !disabled && entries.length > 0 && proposed.length === 0;
  const showList = !settled || settledExpanded;
  const totals = selectionTotals(selectedEntries);

  const toggle = (cardIndex: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardIndex)) next.delete(cardIndex);
      else next.add(cardIndex);
      return next;
    });

  const title = disabled
    ? `正在识别… 已生成 ${entries.length} 笔`
    : settled
      ? "账单草稿已处理"
      : `${proposed.length} 笔待确认`;
  const meta = settled
    ? [
        confirmedCount > 0 ? `已入账 ${confirmedCount} 笔` : "",
        voidedCount > 0 ? `已作废 ${voidedCount} 笔` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : disabled
      ? "生成完后可勾选、编辑并批量入账"
      : [
          `已选 ${selectedEntries.length} 笔`,
          totals.expense > 0n ? `支出 ${amount(totals.expense.toString(), currency)}` : "",
          totals.income > 0n ? `收入 ${amount(totals.income.toString(), currency)}` : "",
          confirmedCount > 0 ? `已入账 ${confirmedCount}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className={cn("ai-card ai-batch", settled && "ai-batch--settled")}>
      <div className="ai-batch__head">
        {settled ? (
          <span className="ai-batch__settled-icon">
            <Check size={14} strokeWidth={3} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="ai-batch__title">{title}</p>
          <p className="ai-batch__meta">{meta}</p>
        </div>
        {settled ? (
          <button
            className="ai-batch__link"
            onClick={() => setSettledExpanded((open) => !open)}
            type="button"
          >
            {settledExpanded ? "收起" : "明细"}
          </button>
        ) : proposed.length > 0 && !disabled ? (
          <button
            className="ai-batch__link"
            disabled={!interactive}
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(proposed.map((e) => e.cardIndex)))
            }
            type="button"
          >
            {allSelected ? "全不选" : "全选"}
          </button>
        ) : null}
      </div>

      {showList ? (
        <ul className="ai-batch__list">
          {entries.map((entry) => (
            <DraftRowItem
              checked={selected.has(entry.cardIndex)}
              entry={entry}
              interactive={interactive}
              key={entry.cardIndex}
              onOpen={() => onEdit(entry.cardIndex)}
              onToggle={() => toggle(entry.cardIndex)}
            />
          ))}
        </ul>
      ) : null}

      {proposed.length > 0 && !disabled ? (
        <div className="ai-batch__footer">
          <div className="relative">
            <IconButton
              disabled={!interactive}
              icon={<MoreHorizontal size={20} />}
              label="更多操作"
              onClick={() => setMenuOpen((open) => !open)}
            />
            <PopoverMenu
              align="start"
              groups={[
                [
                  {
                    icon: <SlidersHorizontal size={18} />,
                    label: "批量设置",
                    description:
                      selectedEntries.length > 0
                        ? `统一修改已选 ${selectedEntries.length} 笔的分类、账户或日期`
                        : "先勾选要修改的草稿",
                    disabled: selectedEntries.length === 0,
                    onSelect: () => setBulkOpen(true),
                  },
                ],
                [
                  {
                    danger: true,
                    icon: <Trash2 size={18} />,
                    label: `作废已选 ${selectedEntries.length} 笔`,
                    disabled: selectedEntries.length === 0,
                    onSelect: () => onVoid(selectedEntries.map((entry) => entry.cardIndex)),
                  },
                ],
              ]}
              onOpenChange={setMenuOpen}
              open={menuOpen}
            />
          </div>
          <Button
            className="flex-1"
            disabled={!interactive || selectedEntries.length === 0 || blockedSelected.length > 0}
            loading={busy}
            onClick={() => onConfirm(selectedEntries.map((entry) => entry.cardIndex))}
          >
            {blockedSelected.length > 0
              ? `${blockedSelected.length} 笔${blockedText(blockedSelected)}，点开补充`
              : selectedEntries.length > 0
                ? `确认入账 ${selectedEntries.length} 笔`
                : "勾选要入账的草稿"}
          </Button>
        </div>
      ) : null}

      <BulkEditSheet
        accounts={accounts}
        categories={categories}
        entries={selectedEntries}
        people={people}
        onClose={() => setBulkOpen(false)}
        onSave={onSave}
        open={bulkOpen}
      />
    </div>
  );
}

function DraftRowItem({
  entry,
  checked,
  interactive,
  onToggle,
  onOpen,
}: {
  entry: DraftEntry;
  checked: boolean;
  interactive: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { card } = entry;
  const draft = card.draft;
  const currency = useCardCurrency(draft.currency);
  const proposed = card.status === "proposed";
  const voided = card.status === "superseded";
  const blocked = proposed && Boolean(card.confirmationBlockedReason);
  const category = categoryText(draft);
  // 没备注时标题用分类顶上（没分类再用记账类型），副行就不再重复分类。
  const title = draft.note || category || TYPE_LABEL[draft.type] || draft.type;
  // 人员紧跟日期：行宽不够时省略号先吃掉末尾的账户，人员始终看得到。
  const detail = [
    draft.occurredTime
      ? `${shortDate(draft.occurredOn)} ${draft.occurredTime}`
      : shortDate(draft.occurredOn),
    draft.personName,
    draft.note ? (category ?? (draft.type === "transfer" ? undefined : "未分类")) : undefined,
    accountText(draft),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={cn("ai-batch__row", !proposed && "is-settled", voided && "is-voided")}>
      {proposed ? (
        <button
          aria-checked={checked}
          aria-label={checked ? "取消选择" : "选择"}
          className="ai-batch__check-hit"
          disabled={!interactive}
          onClick={onToggle}
          role="checkbox"
          type="button"
        >
          <span className={cn("ai-batch__check", checked && "is-checked")}>
            {checked ? <Check size={13} strokeWidth={3.2} /> : null}
          </span>
        </button>
      ) : (
        <span
          aria-label={voided ? "已作废" : "已入账"}
          className={cn("ai-batch__state", voided ? "is-voided" : "is-confirmed")}
        >
          {voided ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
        </span>
      )}
      <button
        className="ai-batch__row-body"
        disabled={!interactive || !proposed}
        onClick={onOpen}
        type="button"
      >
        <span className="ai-batch__row-line">
          <span className="ai-batch__row-note">{title}</span>
          <span className="ai-batch__row-amount" style={{ color: TYPE_COLOR[draft.type] }}>
            {draft.type === "expense" ? "-" : draft.type === "income" ? "+" : ""}
            {amount(draft.grossAmountMicros, currency)}
          </span>
        </span>
        <span className="ai-batch__row-line ai-batch__row-line--sub">
          <span className="ai-batch__row-detail">{detail}</span>
          {proposed ? (
            <span className="ai-batch__tags">
              {blocked ? <span className="ai-tag ai-tag--danger">{blockedTag(card)}</span> : null}
              {card.possibleDuplicate ? (
                <span className="ai-tag ai-tag--warn">疑似重复</span>
              ) : null}
              {card.originalAmountMicros ? <span className="ai-tag">已取整</span> : null}
            </span>
          ) : (
            <span className="ai-batch__row-status">{voided ? "已作废" : "已入账"}</span>
          )}
        </span>
      </button>
      {proposed && interactive ? (
        <ChevronRight aria-hidden className="ai-batch__chevron" size={16} />
      ) : null}
    </li>
  );
}

/**
 * 对选中的多笔统一设置分类 / 账户 / 人员 / 日期。分类只作用于与之收支方向相同的那几笔，
 * 账户只作用于收支（转账两端账户请逐笔编辑），人员与日期对所有类型生效。
 * 每一项默认「不修改」，按钮上写明会影响几笔。
 */
function BulkEditSheet({
  open,
  entries,
  categories,
  accounts,
  people,
  onClose,
  onSave,
}: {
  open: boolean;
  entries: DraftEntry[];
  categories: Category[];
  accounts: Account[];
  people: Person[];
  onClose: () => void;
  onSave: (patches: DraftPatch[]) => Promise<void>;
}) {
  const expenseCount = entries.filter((entry) => entry.card.draft.type === "expense").length;
  const incomeCount = entries.filter((entry) => entry.card.draft.type === "income").length;
  const [categoryType, setCategoryType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoryType(incomeCount > expenseCount ? "income" : "expense");
    setCategoryId(null);
    setAccountId(null);
    setPersonId(null);
    setOccurredOn(null);
    setError(null);
    // 每次打开按当时的选中重置。
  }, [open]);

  const options = useMemo(
    () => categoryOptions(categories, categoryType),
    [categories, categoryType],
  );
  const accountOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);

  const patches = useMemo(() => {
    const result: DraftPatch[] = [];
    for (const entry of entries) {
      const draft = entry.card.draft;
      const next = draftToInput(draft);
      let changed = false;
      if (categoryId && draft.type === categoryType) {
        Object.assign(next, categoryPatch(categories, categoryId));
        changed = true;
      }
      if (accountId && draft.type !== "transfer") {
        Object.assign(next, accountPatch(accounts, accountId));
        changed = true;
      }
      if (personId) {
        next.personId = personId;
        changed = true;
      }
      if (occurredOn) {
        next.occurredOn = occurredOn;
        changed = true;
      }
      if (changed) result.push({ cardIndex: entry.cardIndex, draft: next });
    }
    return result;
  }, [entries, categoryId, categoryType, accountId, personId, occurredOn, categories, accounts]);
  const peopleOptions = useMemo(
    () => [{ id: KEEP_PERSON, label: "不修改" }, ...personOptions(people)],
    [people],
  );

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(patches);
      onClose();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet onClose={onClose} open={open} title={`批量设置 · 已选 ${entries.length} 笔`}>
      <div className="ai-batch__editor">
        {expenseCount > 0 && incomeCount > 0 ? (
          <Tabs
            items={[
              { label: `支出分类 · ${expenseCount} 笔`, value: "expense" },
              { label: `收入分类 · ${incomeCount} 笔`, value: "income" },
            ]}
            onValueChange={(type) => {
              setCategoryType(type as "expense" | "income");
              setCategoryId(null);
            }}
            value={categoryType}
          />
        ) : null}
        {expenseCount + incomeCount > 0 ? (
          <>
            <CategorySelectRow
              onValueChange={setCategoryId}
              options={options}
              placeholder="不修改"
              value={categoryId}
            />
            <AccountSelectRow
              label="账户"
              onValueChange={setAccountId}
              options={accountOptions}
              placeholder="不修改"
              value={accountId}
            />
          </>
        ) : null}
        {people.length > 0 ? (
          <SearchableOptionSelectRow
            label="人员"
            onValueChange={(id) => setPersonId(id === KEEP_PERSON ? null : id)}
            options={peopleOptions}
            placeholder="不修改"
            searchPlaceholder="搜索人员"
            value={personId}
          />
        ) : null}
        {occurredOn ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <DateWheelPicker label="日期" onValueChange={setOccurredOn} value={occurredOn} />
            </div>
            <button className="ai-batch__link" onClick={() => setOccurredOn(null)} type="button">
              不修改
            </button>
          </div>
        ) : (
          <button
            className="transaction-form__select-row"
            onClick={() => setOccurredOn(entries[0]?.card.draft.occurredOn ?? null)}
            type="button"
          >
            <span>日期</span>
            <strong>不修改</strong>
            <ChevronRight size={18} />
          </button>
        )}
        <p className="ai-batch__hint">
          分类只改同方向的草稿{accountId ? "，账户不改转账" : ""}；没动的项保持原样。
        </p>
        {error ? <p className="ai-batch__error">{error}</p> : null}
        <Button block disabled={patches.length === 0} loading={saving} onClick={() => void apply()}>
          {patches.length > 0 ? `应用到 ${patches.length} 笔` : "选择要统一修改的项"}
        </Button>
      </div>
    </BottomSheet>
  );
}
