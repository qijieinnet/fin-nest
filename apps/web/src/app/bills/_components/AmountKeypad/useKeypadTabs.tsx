"use client";

import { useMemo } from "react";
import {
  AccountSelectionList,
  CategorySelectionList,
  PersonChipRow,
  nestedOptionLabel,
} from "@/components/business";
import { orderedFieldsForType } from "@/lib/data/field-order";
import { formatDateLabel } from "../_model/transaction-form-utils";
import type { TransactionFormModel } from "../_model/useTransactionFormModel";
import { DatePanel } from "./DatePanel";
import type { KeypadTab } from ".";

/**
 * 按记账设置组装键盘页签（amount 由外壳自己加在首位）。
 *
 * 顺序跟随 orderedFieldsForType，用户在设置里排的字段顺序在键盘里也是那个顺序；
 * note 不进键盘（要系统键盘，两套键盘会打架），转账只留金额（转出/转入双选留在表单卡片）。
 */
export function useKeypadTabs(model: TransactionFormModel): KeypadTab[] {
  const {
    accountEnabled,
    accountSel,
    acctOptions,
    categoryId,
    catOptions,
    occurredOn,
    order,
    peopleOpts,
    personId,
    setAccountSel,
    setCategoryId,
    setOccurredOn,
    setPersonEnabled,
    setPersonId,
    showAccountCard,
    showPersonCard,
    type,
  } = model;

  return useMemo(() => {
    if (type === "transfer") return [];

    const selectedCategory = catOptions.find((option) => option.id === categoryId);
    const selectedPerson = peopleOpts.find((option) => option.id === personId);
    const tabs: KeypadTab[] = [];

    for (const field of orderedFieldsForType(order, type)) {
      switch (field) {
        case "category":
          tabs.push({
            id: "category",
            label: "分类",
            value: selectedCategory?.label,
            panel: (
              <CategorySelectionList
                disableParentWithChildren
                onSelect={(option) => setCategoryId(option.id)}
                options={catOptions}
                selectedIds={categoryId ? [categoryId] : []}
              />
            ),
          });
          break;

        case "account":
          // 表单里的账户卡是可关的开关卡：关掉表示「这笔账不记账户」。
          // 关着还在键盘里给个选择面板，等于绕过用户刚做的决定，因此整个页签一并隐藏，
          // 开关状态只由表单那张卡决定（acctRequired 时它恒为开）。
          if (!showAccountCard || !accountEnabled) break;
          tabs.push({
            id: "account",
            label: "账户",
            value: nestedOptionLabel(acctOptions, accountSel, "") || undefined,
            panel: (
              <AccountSelectionList
                onSelect={(option) => {
                  if (option.disabled) return;
                  setAccountSel(option.id);
                }}
                options={acctOptions}
                selectedId={accountSel}
              />
            ),
          });
          break;

        case "person":
          if (!showPersonCard) break;
          tabs.push({
            id: "person",
            label: "人员",
            value: selectedPerson?.label,
            panel: (
              <PersonChipRow
                onValueChange={(id) => {
                  setPersonId(id);
                  setPersonEnabled(true);
                }}
                options={peopleOpts}
                value={personId}
              />
            ),
          });
          break;

        case "date":
          tabs.push({
            id: "date",
            label: "日期",
            // 回显已选日期：底部的「今天」在别的页签下按也能看到结果变化。
            value: formatDateLabel(occurredOn),
            panel: <DatePanel onValueChange={setOccurredOn} value={occurredOn} />,
          });
          break;

        default:
          break;
      }
    }

    return tabs;
  }, [
    accountEnabled,
    accountSel,
    acctOptions,
    categoryId,
    catOptions,
    occurredOn,
    order,
    peopleOpts,
    personId,
    setAccountSel,
    setCategoryId,
    setOccurredOn,
    setPersonEnabled,
    setPersonId,
    showAccountCard,
    showPersonCard,
    type,
  ]);
}
