"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Switch } from "@/components/ui";
import { createClientId } from "@/lib/id/client-id";
import type { BusinessOption } from "./business-types";
import { AccountSelectRow } from "./TransactionFieldRows";
import { InlineHint } from "./InlineHint";

export type RecoverablePayableItem = {
  accountId: string | null;
  amount: string;
  id: string;
};

type RecoverablePayableEditorProps = {
  accountOptions: BusinessOption[];
  addLabel?: string;
  enabled?: boolean;
  emptyText?: string;
  hint?: string;
  items: RecoverablePayableItem[];
  label?: string;
  onChange: (items: RecoverablePayableItem[]) => void;
  onEnabledChange?: (enabled: boolean) => void;
};

function makeItem(): RecoverablePayableItem {
  return { accountId: null, amount: "", id: createClientId("relation") };
}

export function RecoverablePayableEditor({
  accountOptions,
  addLabel,
  enabled,
  emptyText = "还没有可选项目，可到「账户」中先添加项目",
  hint,
  items,
  label = "可收回 / 需归还",
  onChange,
  onEnabledChange,
}: RecoverablePayableEditorProps) {
  const active = enabled ?? items.length > 0;

  return (
    <div className="biz-rp-editor biz-toggle-card">
      <div className="biz-toggle-card__header">
        <span className="biz-toggle-card__copy">
          <strong>
            {label}
            {hint ? <InlineHint text={hint} /> : null}
          </strong>
        </span>
        <Switch checked={active} disabled={!onEnabledChange} label={label} onCheckedChange={onEnabledChange} />
      </div>
      {active ? (
        <div className="biz-rp-editor__body">
          {accountOptions.length === 0 ? <p className="biz-muted">{emptyText}</p> : null}
          {accountOptions.length > 0 && items.length === 0 ? <p className="biz-muted">还没有关联项目</p> : null}
          {items.map((item, index) => (
            <div className="biz-rp-editor__row" key={item.id}>
              <div className="biz-rp-editor__field">
                <AccountSelectRow
                  className="biz-rp-editor__select"
                  hideLabel
                  label={`项目 ${index + 1}`}
                  onValueChange={(accountId) =>
                    onChange(
                      items.map((current) =>
                        current.id === item.id ? { ...current, accountId } : current,
                      ),
                    )
                  }
                  options={accountOptions}
                  placeholder="选择账户"
                  value={item.accountId}
                />
              </div>
              <label className="biz-rp-editor__field biz-rp-editor__field--amount">
                <span className="biz-rp-editor__amount">
                  <span>¥</span>
                  <input
                    aria-label="金额"
                    inputMode="decimal"
                    onChange={(event) =>
                      onChange(items.map((current) => (current.id === item.id ? { ...current, amount: event.currentTarget.value } : current)))
                    }
                    placeholder="0.00"
                    value={item.amount}
                  />
                </span>
              </label>
              <IconButton
                icon={<Trash2 size={17} />}
                label="删除关联金额"
                onClick={() => onChange(items.filter((current) => current.id !== item.id))}
                variant="muted"
              />
            </div>
          ))}
          {accountOptions.length > 0 ? (
            <Button
              icon={<Plus size={16} />}
              onClick={() => onChange([...items, makeItem()])}
              variant="secondary"
            >
              {addLabel ?? `添加${label}项目`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
