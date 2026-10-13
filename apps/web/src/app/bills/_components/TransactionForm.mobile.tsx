"use client";

import {
  AccountSelectRow,
  AmountInput,
  AssetLinkCard,
  AttachmentPicker,
  CategorySelectRow,
  DateWheelPicker,
  FieldCard,
  PersonSelectField,
  RecoverablePayableEditor,
  ToggleCard,
} from "@/components/business";
import { Input, Tabs } from "@/components/ui";
import type { TransactionType } from "@/lib/api";
import { orderedFieldsForType } from "@/lib/data/field-order";
import { currencySymbolOf } from "@/lib/money";
import { AmountKeypad } from "./AmountKeypad";
import { TransactionFxFields } from "./TransactionFxFields";
import { useKeypadTabs } from "./AmountKeypad/useKeypadTabs";
import { quickEntrySeed } from "./_model/quick-entry-handoff";
import {
  NOTE_MAX_LENGTH,
  TYPE_TAB_ITEMS,
  formatDateLabel,
  todayKey,
} from "./_model/transaction-form-utils";
import type { TransactionFormRenderProps, TransactionSeed } from "./_model/useTransactionFormModel";
import { t } from "@/lib/i18n";

/** 交易表单移动渲染层（原 TransactionForm 主体，行为不变）。数据来自共享视图模型。 */
export function TransactionFormMobile({
  formId,
  keypadOnly = false,
  keypadOpen,
  keypadSubmitLabel,
  model,
  onExpand,
  onKeypadOpenChange,
  onQuickTemplates,
  openCreateItemSheet,
}: TransactionFormRenderProps & {
  formId?: string;
  /** 只渲染键盘（账单列表的快捷记账）：表单卡片不出现，字段全在键盘页签里改。 */
  keypadOnly?: boolean;
  keypadOpen?: boolean;
  keypadSubmitLabel?: string;
  onExpand?: (seed: TransactionSeed) => void;
  onKeypadOpenChange?: (open: boolean) => void;
  onQuickTemplates?: () => void;
}) {
  const { type, isPendingMode } = model;
  const keypadTabs = useKeypadTabs(model, { keypadOnly });
  const primaryRelationLabel = type === "income" ? t("需归还") : t("可收回");
  const linkedRelationLabel = type === "income" ? t("可收回") : t("需归还");
  const primaryRelationHint =
    type === "income" ? t("这笔收入中需要归还他人的部分") : t("这笔支出中可向他人收回的部分");
  const linkedRelationHint =
    type === "income"
      ? t("这笔收入将自动冲减选中的可收回项目并参与计算")
      : t("这笔支出将自动冲减选中的需归还项目并参与计算");

  const renderOrderedField = (field: string) => {
    switch (field) {
      case "category":
        if (type === "transfer") return null;
        return (
          <FieldCard className="transaction-form__picker-card" key="category" label={t("分类")}>
            <CategorySelectRow
              onValueChange={model.setCategoryId}
              options={model.catOptions}
              value={model.categoryId}
            />
          </FieldCard>
        );
      case "account":
        if (type === "transfer") {
          return (
            <FieldCard className="transaction-form__picker-card" key="account" label={t("账户")}>
              <AccountSelectRow
                label={t("转出账户")}
                onValueChange={model.setFromSel}
                options={model.acctOptions}
                placeholder={t("选择账户")}
                value={model.fromSel}
              />
              <span className="transaction-form__divider" />
              <AccountSelectRow
                label={t("转入账户")}
                onValueChange={model.setToSel}
                options={model.acctOptions}
                placeholder={t("选择账户")}
                value={model.toSel}
              />
            </FieldCard>
          );
        }
        if (!model.showAccountCard) return null;
        return (
          <ToggleCard
            checked={model.accountEnabled}
            disabled={model.acctRequired}
            key="account"
            label={t("账户")}
            onCheckedChange={(checked) => {
              model.setAccountEnabled(checked);
              if (!checked) model.setAccountSel(null);
            }}
          >
            <AccountSelectRow
              hideLabel
              label={t("选择账户")}
              onValueChange={model.setAccountSel}
              options={model.acctOptions}
              value={model.accountSel}
            />
          </ToggleCard>
        );
      case "person":
        if (!model.showPersonCard) return null;
        return (
          <PersonSelectField
            checked={model.personEnabled}
            disabled={model.personRequired}
            key="person"
            label={t("人员")}
            onCheckedChange={(checked) => {
              model.setPersonEnabled(checked);
              if (!checked) model.setPersonId(null);
            }}
            onValueChange={model.setPersonId}
            options={model.peopleOpts}
            value={model.personId}
          />
        );
      case "date":
        return (
          <FieldCard
            className="transaction-form__date-card"
            key="date"
            label={t("日期")}
            value={formatDateLabel(model.occurredOn)}
          >
            <DateWheelPicker onValueChange={model.setOccurredOn} value={model.occurredOn} />
          </FieldCard>
        );
      case "note":
        if (!model.showNoteCard) return null;
        return (
          <FieldCard className="transaction-form__note-card" key="note" label={t("备注")}>
            <div className="transaction-form__note-row">
              <span>{t("备注")}</span>
              <Input
                aria-label={t("备注")}
                label={t("备注")}
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => model.setNote(event.target.value)}
                // 备注要系统键盘，两套键盘叠在一起没法用——聚焦时先收起自绘键盘。
                onFocus={() => onKeypadOpenChange?.(false)}
                placeholder=""
                value={model.note}
              />
            </div>
          </FieldCard>
        );
      default:
        return null;
    }
  };

  const keypad = onKeypadOpenChange ? (
    <AmountKeypad
      amount={model.amount}
      canSubmit={!model.validationMessage && !model.mutationState.isPending}
      currencySymbol={currencySymbolOf(model.fx.entryCurrency)}
      decimalPlaces={model.fx.entryDecimalPlaces}
      halfScreen={keypadOnly}
      onAmountChange={model.setAmount}
      onClose={() => onKeypadOpenChange(false)}
      onExpand={onExpand ? () => onExpand(quickEntrySeed(model)) : undefined}
      onQuickTemplates={onQuickTemplates}
      onSubmit={() => model.handleSubmit()}
      onToday={() => model.setOccurredOn(todayKey())}
      // 快捷记账没有表单页，类型只能在键盘里切；表单页顶部本来就有类型页签，不重复给。
      // 待确认模式类型固定（后端确认接口不支持改类型），同样不给。
      onTypeChange={keypadOnly && !isPendingMode ? model.handleTypeChange : undefined}
      open={Boolean(keypadOpen)}
      savedSignal={model.savedCount}
      submitLabel={keypadSubmitLabel}
      submitting={model.mutationState.isPending}
      tabs={keypadTabs}
      type={type}
    />
  ) : null;

  // 快捷记账：页面上只有这块键盘，没有表单卡片（键盘自带 portal，不占页面位置）。
  if (keypadOnly) return keypad;

  return (
    <form className="transaction-form" id={formId} onSubmit={model.handleSubmit}>
      <div className="transaction-form__top">
        <Tabs
          className="transaction-form__type-tabs"
          // 待确认模式类型固定（后端确认接口不支持改类型），只显示当前类型页签。
          items={
            isPendingMode ? TYPE_TAB_ITEMS.filter((item) => item.value === type) : TYPE_TAB_ITEMS
          }
          onValueChange={(nextType) => model.handleTypeChange(nextType as TransactionType)}
          value={type}
        />
        <AmountInput
          className="transaction-form__amount"
          currencySymbol={currencySymbolOf(model.fx.entryCurrency)}
          decimalPlaces={model.fx.entryDecimalPlaces}
          label={t("金额")}
          onDisplayActivate={() => onKeypadOpenChange?.(true)}
          onValueChange={model.setAmount}
          // 键盘接管时金额区变只读展示层：readOnly 的 input 在部分 iOS Safari 上仍会弹系统键盘。
          readOnlyDisplay={Boolean(onKeypadOpenChange)}
          value={model.amount}
        />
      </div>

      <div className="transaction-form__cards">
        <TransactionFxFields fx={model.fx} onInputFocus={() => onKeypadOpenChange?.(false)} />
        {orderedFieldsForType(model.order, type).map(renderOrderedField)}

        {!isPendingMode && type !== "transfer" ? (
          <>
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
          </>
        ) : null}
      </div>

      {keypad}
    </form>
  );
}
