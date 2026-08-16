"use client";

import { useMemo } from "react";
import {
  AccountSelectionList,
  CategorySelectionList,
  PersonChipRow,
  nestedOptionLabel,
} from "@/components/business";
import { orderedFieldsForType } from "@/lib/data/field-order";
import { NOTE_MAX_LENGTH, formatDateLabel } from "../_model/transaction-form-utils";
import type { TransactionFormModel } from "../_model/useTransactionFormModel";
import { DatePanel } from "./DatePanel";
import { NotePanel } from "./NotePanel";
import type { KeypadTab } from ".";

/**
 * 按记账设置组装键盘页签（amount 由外壳自己加在首位）。
 *
 * 顺序跟随 orderedFieldsForType，用户在设置里排的字段顺序在键盘里也是那个顺序；
 * 转账没有分类，转出/转入拆成两个页签（表单页有双选卡片，只有快捷记账需要）；
 * 人员与日期转账同样适用（表单卡片与 buildPayload 的转账分支都带人员），照常给页签。
 */
export function useKeypadTabs(
  model: TransactionFormModel,
  { keypadOnly = false }: { keypadOnly?: boolean } = {},
): KeypadTab[] {
  const {
    accountEnabled,
    accountSel,
    acctOptions,
    categoryId,
    catOptions,
    fromSel,
    note,
    occurredOn,
    order,
    peopleOpts,
    personId,
    setAccountEnabled,
    setAccountSel,
    setCategoryId,
    setFromSel,
    setNote,
    setOccurredOn,
    setPersonEnabled,
    setPersonId,
    setToSel,
    showAccountCard,
    showNoteCard,
    showPersonCard,
    toSel,
    type,
  } = model;

  return useMemo(() => {
    const noteTab: KeypadTab | null = showNoteCard
      ? {
          id: "note",
          label: "备注",
          value: note || undefined,
          panel: <NotePanel maxLength={NOTE_MAX_LENGTH} onValueChange={setNote} value={note} />,
        }
      : null;

    const selectedCategory = catOptions.find((option) => option.id === categoryId);
    const selectedPerson = peopleOpts.find((option) => option.id === personId);
    const tabs: KeypadTab[] = [];

    for (const field of orderedFieldsForType(order, type)) {
      switch (field) {
        case "category":
          // 转账不涉及分类。
          if (type === "transfer") break;
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
          if (type === "transfer") {
            // 表单页的转出/转入是卡片里的双选器，键盘不重复给；
            // 快捷记账没有卡片，这两个页签是唯一入口，缺了转账就记不成。
            if (!keypadOnly) break;
            tabs.push({
              id: "fromAccount",
              label: "转出",
              value: nestedOptionLabel(acctOptions, fromSel, "") || undefined,
              panel: (
                <AccountSelectionList
                  onSelect={(option) => {
                    if (option.disabled) return;
                    setFromSel(option.id);
                  }}
                  options={acctOptions}
                  selectedId={fromSel}
                />
              ),
            });
            tabs.push({
              id: "toAccount",
              label: "转入",
              value: nestedOptionLabel(acctOptions, toSel, "") || undefined,
              panel: (
                <AccountSelectionList
                  onSelect={(option) => {
                    if (option.disabled) return;
                    setToSel(option.id);
                  }}
                  options={acctOptions}
                  selectedId={toSel}
                />
              ),
            });
            break;
          }
          // 表单里的账户卡是可关的开关卡：关掉表示「这笔账不记账户」。
          // 关着还在键盘里给个选择面板，等于绕过用户刚做的决定，因此整个页签一并隐藏，
          // 开关状态只由表单那张卡决定（acctRequired 时它恒为开）。
          // 快捷记账例外：那边根本没有卡，页签是唯一入口，必须常显，选中即视为开启。
          if (!showAccountCard || (!accountEnabled && !keypadOnly)) break;
          tabs.push({
            id: "account",
            label: "账户",
            // 回显与选中态都跟着开关走：切一趟转账再切回来，handleTypeChange 关掉了开关
            // 但留着 accountSel，只看 accountSel 会显示一个保存时并不会写进去的账户。
            value: accountEnabled
              ? nestedOptionLabel(acctOptions, accountSel, "") || undefined
              : undefined,
            panel: (
              <AccountSelectionList
                onSelect={(option) => {
                  if (option.disabled) return;
                  setAccountSel(option.id);
                  setAccountEnabled(true);
                }}
                options={acctOptions}
                selectedId={accountEnabled ? accountSel : null}
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

        case "note":
          if (noteTab) tabs.push(noteTab);
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
    fromSel,
    keypadOnly,
    note,
    occurredOn,
    order,
    peopleOpts,
    personId,
    setAccountEnabled,
    setAccountSel,
    setCategoryId,
    setFromSel,
    setNote,
    setOccurredOn,
    setPersonEnabled,
    setPersonId,
    setToSel,
    showAccountCard,
    showNoteCard,
    showPersonCard,
    toSel,
    type,
  ]);
}
