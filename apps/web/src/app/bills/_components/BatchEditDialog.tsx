"use client";

import { useMemo, useState } from "react";
import type { BusinessOption, CategoryOption } from "@/components/business";
import { AccountSelect, CategorySelect, DesktopDatePicker, FormSelect, Modal } from "@/components/desktop";
import { Button, Input } from "@/components/ui";
import type { Account, BatchUpdateField, BatchUpdateTransactionsInput } from "@/lib/api";
import { moneyAccountOptions, resolveAccountSelection } from "@/lib/data/options";

/** 批量修改单字段的补丁（不含 transactionIds，由调用方补齐）。 */
export type BatchFieldPatch = Omit<BatchUpdateTransactionsInput, "transactionIds">;

type BatchEditDialogProps = {
  /** 当前编辑的字段；null 表示关闭。 */
  field: BatchUpdateField | null;
  /** 已选条数（用于标题提示）。 */
  count: number;
  /** 勾选的是否全为转账：账户改为转出/转入两侧。 */
  allTransfer: boolean;
  categoryOptions: CategoryOption[];
  accounts: Account[];
  personOptions: BusinessOption[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (patch: BatchFieldPatch) => void;
};

const FIELD_TITLE: Record<BatchUpdateField, string> = {
  category: "批量修改分类",
  account: "批量修改账户",
  person: "批量修改人员",
  occurredOn: "批量修改日期",
  note: "批量修改备注",
};

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 批量修改弹窗：一次只改一项。转账对分类/账户不适用，提交后由服务端跳过。 */
export function BatchEditDialog({
  field,
  count,
  allTransfer,
  categoryOptions,
  accounts,
  personOptions,
  submitting,
  onClose,
  onSubmit,
}: BatchEditDialogProps) {
  return (
    <Modal
      className="batch-edit-modal"
      onClose={onClose}
      open={field !== null}
      title={field ? FIELD_TITLE[field] : ""}
    >
      {field ? (
        <BatchEditBody
          accounts={accounts}
          allTransfer={allTransfer}
          categoryOptions={categoryOptions}
          count={count}
          field={field}
          onClose={onClose}
          onSubmit={onSubmit}
          personOptions={personOptions}
          submitting={submitting}
        />
      ) : null}
    </Modal>
  );
}

function BatchEditBody({
  field,
  count,
  allTransfer,
  categoryOptions,
  accounts,
  personOptions,
  submitting,
  onClose,
  onSubmit,
}: Omit<BatchEditDialogProps, "field"> & { field: BatchUpdateField }) {
  const [selectValue, setSelectValue] = useState<string | null>(null);
  const [fromValue, setFromValue] = useState<string | null>(null);
  const [toValue, setToValue] = useState<string | null>(null);
  const [dateValue, setDateValue] = useState<string>(() => todayKey());
  const [noteValue, setNoteValue] = useState<string>("");

  const accountSelectOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const transferAccount = field === "account" && allTransfer;

  const canSubmit = (() => {
    if (submitting) return false;
    if (field === "category") return selectValue != null;
    if (field === "account") return transferAccount ? fromValue != null || toValue != null : selectValue != null;
    if (field === "occurredOn") return Boolean(dateValue);
    return true; // person / note 允许留空（清除）
  })();

  const buildPatch = (): BatchFieldPatch | null => {
    switch (field) {
      case "category": {
        if (!selectValue) return null;
        const option = categoryOptions.find((item) => item.id === selectValue);
        if (!option) return null;
        return option.parentId
          ? { field: "category", categoryId: option.parentId, subcategoryId: option.id }
          : { field: "category", categoryId: option.id };
      }
      case "account": {
        if (transferAccount) {
          const from = fromValue ? resolveAccountSelection(accounts, fromValue) : null;
          const to = toValue ? resolveAccountSelection(accounts, toValue) : null;
          if (!from?.accountId && !to?.accountId) return null;
          return {
            field: "account",
            fromAccountId: from?.accountId,
            fromSubAccountId: from?.subAccountId,
            toAccountId: to?.accountId,
            toSubAccountId: to?.subAccountId,
          };
        }
        if (!selectValue) return null;
        const { accountId, subAccountId } = resolveAccountSelection(accounts, selectValue);
        if (!accountId) return null;
        return { field: "account", accountId, subAccountId };
      }
      case "person":
        return { field: "person", personId: selectValue ?? undefined };
      case "occurredOn":
        return { field: "occurredOn", occurredOn: dateValue };
      case "note":
        return { field: "note", note: noteValue };
    }
  };

  const handleSubmit = () => {
    const patch = buildPatch();
    if (patch) onSubmit(patch);
  };

  const skipHint =
    field === "category" || (field === "account" && !allTransfer)
      ? "（转账记录将自动跳过）"
      : "";

  return (
    <div className="batch-edit">
      <p className="batch-edit__hint">
        已选 {count} 笔{skipHint}
      </p>

      <div className="batch-edit__control">
        {field === "category" ? (
          <CategorySelect onChange={setSelectValue} options={categoryOptions} value={selectValue} />
        ) : null}
        {field === "account" && transferAccount ? (
          <div className="batch-edit__pair">
            <label className="batch-edit__field">
              <span className="batch-edit__field-label">转出账户</span>
              <AccountSelect
                allowClear
                onChange={setFromValue}
                options={accountSelectOptions}
                placeholder="不修改"
                title="选择转出账户"
                value={fromValue}
              />
            </label>
            <label className="batch-edit__field">
              <span className="batch-edit__field-label">转入账户</span>
              <AccountSelect
                allowClear
                onChange={setToValue}
                options={accountSelectOptions}
                placeholder="不修改"
                title="选择转入账户"
                value={toValue}
              />
            </label>
          </div>
        ) : null}
        {field === "account" && !transferAccount ? (
          <AccountSelect
            onChange={setSelectValue}
            options={accountSelectOptions}
            value={selectValue}
          />
        ) : null}
        {field === "person" ? (
          <FormSelect
            allowClear
            onChange={setSelectValue}
            options={personOptions}
            placeholder="选择人员（留空为清除）"
            value={selectValue}
          />
        ) : null}
        {field === "occurredOn" ? (
          <DesktopDatePicker onChange={setDateValue} value={dateValue} />
        ) : null}
        {field === "note" ? (
          <Input
            aria-label="备注"
            label="备注"
            maxLength={240}
            onChange={(event) => setNoteValue(event.target.value)}
            placeholder="添加备注（留空为清除）…"
            value={noteValue}
          />
        ) : null}
      </div>

      <div className="batch-edit__footer">
        <Button onClick={onClose} type="button" variant="secondary">
          取消
        </Button>
        <Button disabled={!canSubmit} onClick={handleSubmit} type="button" variant="primary">
          {submitting ? "修改中…" : "确定"}
        </Button>
      </div>
    </div>
  );
}
