"use client";

import {
  AmountInput,
  AssetLinkCard,
  AttachmentPicker,
  RecoverablePayableEditor,
} from "@/components/business";
import { AccountSelect, CategorySelect, DesktopDatePicker, FormSelect } from "@/components/desktop";
import { Tabs } from "@/components/ui";
import type { TransactionType } from "@/lib/api";
import type { TransactionFormRenderProps } from "./_model/useTransactionFormModel";

const TYPE_TAB_ITEMS: Array<{ label: string; value: TransactionType }> = [
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
  { label: "转账", value: "transfer" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="transaction-form-desktop__field">
      <span className="transaction-form-desktop__field-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * 交易表单桌面渲染层：两列版式，分类/账户/人员/日期为直接可见控件（FormSelect / 日历），
 * Tab 顺序遍历、Enter 提交（备注为单行输入，回车即提交）。数据来自共享视图模型。
 */
export function TransactionFormDesktop({
  formId,
  model,
  openCreateItemSheet,
}: TransactionFormRenderProps & { formId?: string }) {
  const { type, isPendingMode } = model;
  const primaryRelationLabel = type === "income" ? "需归还" : "可收回";
  const linkedRelationLabel = type === "income" ? "可收回" : "需归还";
  const primaryRelationHint =
    type === "income" ? "这笔收入中需要归还他人的部分" : "这笔支出中可向他人收回的部分";
  const linkedRelationHint =
    type === "income"
      ? "这笔收入将自动冲减选中的可收回项目并参与计算"
      : "这笔支出将自动冲减选中的需归还项目并参与计算";

  return (
    <form className="transaction-form transaction-form-desktop" id={formId} onSubmit={model.handleSubmit}>
      <div className="transaction-form-desktop__top">
        <Tabs
          className="transaction-form__type-tabs"
          items={
            isPendingMode ? TYPE_TAB_ITEMS.filter((item) => item.value === type) : TYPE_TAB_ITEMS
          }
          onValueChange={(nextType) => model.handleTypeChange(nextType as TransactionType)}
          value={type}
        />
        <AmountInput
          className="transaction-form__amount"
          decimalPlaces={model.decimalPlaces}
          label="金额"
          onValueChange={model.setAmount}
          value={model.amount}
        />
      </div>

      <div className="transaction-form-desktop__grid">
        {type === "transfer" ? (
          <>
            <Field label="转出账户">
              <AccountSelect
                onChange={model.setFromSel}
                options={model.acctOptions}
                title="选择转出账户"
                value={model.fromSel}
              />
            </Field>
            <Field label="转入账户">
              <AccountSelect
                onChange={model.setToSel}
                options={model.acctOptions}
                title="选择转入账户"
                value={model.toSel}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="分类">
              <CategorySelect
                onChange={model.setCategoryId}
                options={model.catOptions}
                value={model.categoryId}
              />
            </Field>
            {model.showAccountCard ? (
              <Field label="账户">
                <AccountSelect
                  allowClear={!model.acctRequired}
                  onChange={(v) => {
                    model.setAccountSel(v);
                    model.setAccountEnabled(v != null);
                  }}
                  options={model.acctOptions}
                  placeholder={model.acctRequired ? "选择账户（必填）" : "选择账户"}
                  value={model.accountSel}
                />
              </Field>
            ) : null}
          </>
        )}

        {model.showPersonCard ? (
          <Field label="人员">
            <FormSelect
              allowClear={!model.personRequired}
              onChange={(v) => {
                model.setPersonId(v);
                model.setPersonEnabled(v != null);
              }}
              options={model.peopleOpts}
              placeholder={model.personRequired ? "选择人员（必填）" : "选择人员"}
              value={model.personId}
            />
          </Field>
        ) : null}

        <Field label="日期">
          <DesktopDatePicker onChange={model.setOccurredOn} value={model.occurredOn} />
        </Field>

        {model.showNoteCard ? (
          <label className="transaction-form-desktop__note">
            <span className="transaction-form-desktop__note-label">备注</span>
            <input
              aria-label="备注"
              className="transaction-form-desktop__note-input"
              maxLength={240}
              onChange={(event) => model.setNote(event.target.value)}
              placeholder="添加备注…"
              value={model.note}
            />
          </label>
        ) : null}
      </div>

      {!isPendingMode && type !== "transfer" ? (
        <div className="transaction-form-desktop__advanced">
          <RecoverablePayableEditor
            accountOptions={model.primaryRelationOpts}
            addLabel={`添加${primaryRelationLabel}项目`}
            emptyText={`还没有${primaryRelationLabel}项目，可到「账户」中先添加${primaryRelationLabel}账户`}
            enabled={model.primaryRelationsEnabled}
            hint={primaryRelationHint}
            items={model.primaryRelationItems}
            label={primaryRelationLabel}
            onChange={model.setPrimaryRelationItems}
            onEnabledChange={model.setPrimaryRelationsEnabled}
          />
          <RecoverablePayableEditor
            accountOptions={model.linkedRelationOpts}
            addLabel={`添加${linkedRelationLabel}项目`}
            emptyText={`还没有${linkedRelationLabel}项目，可到「账户」中先添加${linkedRelationLabel}账户`}
            enabled={model.linkedRelationsEnabled}
            hint={linkedRelationHint}
            items={model.linkedRelationItems}
            label={`冲减${linkedRelationLabel}项目`}
            onChange={model.setLinkedRelationItems}
            onEnabledChange={model.setLinkedRelationsEnabled}
          />
          {model.showAttachmentCard ? (
            <AttachmentPicker
              enabled={model.attachmentsEnabled}
              items={model.attachmentItems}
              onEnabledChange={model.setAttachmentsEnabled}
              onFilesSelected={model.addAttachments}
              onOpen={model.openAttachment}
              onRemove={model.removeAttachment}
            />
          ) : null}
          <AssetLinkCard
            checked={model.insuranceEnabled}
            emptyText="还没有保单，可到「我的 · 保险管理」中先添加保单"
            hint={
              type === "income"
                ? "把这笔收入（如理赔款）关联到一份保单"
                : "把这笔支出（如保费）关联到一份保单"
            }
            items={model.insuranceOptions}
            label="保险"
            onCheckedChange={(checked) => {
              model.setInsuranceEnabled(checked);
              if (!checked) model.setSelectedInsuranceId(null);
            }}
            onSelect={model.setSelectedInsuranceId}
            selectedId={model.selectedInsuranceId}
          />
          <AssetLinkCard
            checked={model.itemEnabled}
            createLabel="新建物品"
            emptyText="还没有物品，可到「我的 · 物品管理」中先添加物品"
            hint={
              type === "income"
                ? "把这笔收入（如转卖回款）关联到一件物品"
                : "把这笔支出（如耗材、维修）关联到一件物品"
            }
            items={model.itemOptions}
            label="关联物品"
            onCheckedChange={(checked) => {
              model.setItemEnabled(checked);
              if (!checked) model.setSelectedItemId(null);
            }}
            onCreate={openCreateItemSheet}
            onSelect={(itemId) => {
              model.setSelectedItemId(itemId);
              model.setSelectedItemLinkKind("consumable");
            }}
            selectedId={model.selectedItemId}
          />
        </div>
      ) : null}
    </form>
  );
}
