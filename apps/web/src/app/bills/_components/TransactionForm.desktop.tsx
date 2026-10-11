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
import { TYPE_TAB_ITEMS } from "./_model/transaction-form-utils";
import type { TransactionFormRenderProps } from "./_model/useTransactionFormModel";
import { t } from "@/lib/i18n";

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
  const primaryRelationLabel = type === "income" ? t("需归还") : t("可收回");
  const linkedRelationLabel = type === "income" ? t("可收回") : t("需归还");
  const primaryRelationHint =
    type === "income" ? t("这笔收入中需要归还他人的部分") : t("这笔支出中可向他人收回的部分");
  const linkedRelationHint =
    type === "income"
      ? t("这笔收入将自动冲减选中的可收回项目并参与计算")
      : t("这笔支出将自动冲减选中的需归还项目并参与计算");

  return (
    <form
      className="transaction-form transaction-form-desktop"
      id={formId}
      onSubmit={model.handleSubmit}
    >
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
          label={t("金额")}
          onValueChange={model.setAmount}
          value={model.amount}
        />
      </div>

      <div className="transaction-form-desktop__grid">
        {type === "transfer" ? (
          <>
            <Field label={t("转出账户")}>
              <AccountSelect
                onChange={model.setFromSel}
                options={model.acctOptions}
                title={t("选择转出账户")}
                value={model.fromSel}
              />
            </Field>
            <Field label={t("转入账户")}>
              <AccountSelect
                onChange={model.setToSel}
                options={model.acctOptions}
                title={t("选择转入账户")}
                value={model.toSel}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("分类")}>
              <CategorySelect
                onChange={model.setCategoryId}
                options={model.catOptions}
                value={model.categoryId}
              />
            </Field>
            {model.showAccountCard ? (
              <Field label={t("账户")}>
                <AccountSelect
                  allowClear={!model.acctRequired}
                  onChange={(v) => {
                    model.setAccountSel(v);
                    model.setAccountEnabled(v != null);
                  }}
                  options={model.acctOptions}
                  placeholder={model.acctRequired ? t("选择账户（必填）") : t("选择账户")}
                  value={model.accountSel}
                />
              </Field>
            ) : null}
          </>
        )}

        {model.showPersonCard ? (
          <Field label={t("人员")}>
            <FormSelect
              allowClear={!model.personRequired}
              onChange={(v) => {
                model.setPersonId(v);
                model.setPersonEnabled(v != null);
              }}
              options={model.peopleOpts}
              placeholder={model.personRequired ? t("选择人员（必填）") : t("选择人员")}
              value={model.personId}
            />
          </Field>
        ) : null}

        <Field label={t("日期")}>
          <DesktopDatePicker onChange={model.setOccurredOn} value={model.occurredOn} />
        </Field>

        {model.showNoteCard ? (
          <label className="transaction-form-desktop__note">
            <span className="transaction-form-desktop__note-label">{t("备注")}</span>
            <input
              aria-label={t("备注")}
              className="transaction-form-desktop__note-input"
              maxLength={240}
              onChange={(event) => model.setNote(event.target.value)}
              placeholder={t("添加备注…")}
              value={model.note}
            />
          </label>
        ) : null}
      </div>

      {!isPendingMode && type !== "transfer" ? (
        <div className="transaction-form-desktop__advanced">
          <RecoverablePayableEditor
            accountOptions={model.primaryRelationOpts}
            addLabel={t("添加{primaryRelationLabel}项目", { primaryRelationLabel })}
            emptyText={t(
              "还没有{primaryRelationLabel}项目，可到「账户」中先添加{primaryRelationLabel2}账户",
              { primaryRelationLabel, primaryRelationLabel2: primaryRelationLabel },
            )}
            enabled={model.primaryRelationsEnabled}
            hint={primaryRelationHint}
            items={model.primaryRelationItems}
            label={primaryRelationLabel}
            onChange={model.setPrimaryRelationItems}
            onEnabledChange={model.setPrimaryRelationsEnabled}
          />
          <RecoverablePayableEditor
            accountOptions={model.linkedRelationOpts}
            addLabel={t("添加{linkedRelationLabel}项目", { linkedRelationLabel })}
            emptyText={t(
              "还没有{linkedRelationLabel}项目，可到「账户」中先添加{linkedRelationLabel2}账户",
              { linkedRelationLabel, linkedRelationLabel2: linkedRelationLabel },
            )}
            enabled={model.linkedRelationsEnabled}
            hint={linkedRelationHint}
            items={model.linkedRelationItems}
            label={t("冲减{linkedRelationLabel}项目", { linkedRelationLabel })}
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
            emptyText={t("还没有保单，可到「我的 · 保险管理」中先添加保单")}
            hint={
              type === "income"
                ? t("把这笔收入（如理赔款）关联到一份保单")
                : t("把这笔支出（如保费）关联到一份保单")
            }
            items={model.insuranceOptions}
            label={t("保险")}
            onCheckedChange={(checked) => {
              model.setInsuranceEnabled(checked);
              if (!checked) model.setSelectedInsuranceId(null);
            }}
            onSelect={model.setSelectedInsuranceId}
            selectedId={model.selectedInsuranceId}
          />
          <AssetLinkCard
            checked={model.itemEnabled}
            createLabel={t("新建物品")}
            emptyText={t("还没有物品，可到「我的 · 物品管理」中先添加物品")}
            hint={
              type === "income"
                ? t("把这笔收入（如转卖回款）关联到一件物品")
                : t("把这笔支出（如耗材、维修）关联到一件物品")
            }
            items={model.itemOptions}
            label={t("关联物品")}
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

          <AssetLinkCard
            checked={model.subscriptionEnabled}
            emptyText={t("还没有订阅，可到「我的 · 订阅管理」中先添加订阅")}
            hint={
              type === "income"
                ? t("把这笔收入（如退款）关联到一个订阅")
                : t("把这笔支出（如订阅费）关联到一个订阅")
            }
            items={model.subscriptionOptions}
            label={t("关联订阅")}
            onCheckedChange={(checked) => {
              model.setSubscriptionEnabled(checked);
              if (!checked) model.setSelectedSubscriptionId(null);
            }}
            onSelect={model.setSelectedSubscriptionId}
            selectedId={model.selectedSubscriptionId}
          />
        </div>
      ) : null}
    </form>
  );
}
