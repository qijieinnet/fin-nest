"use client";

import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useState } from "react";
import type { NotifyTarget, ReminderSchedule } from "@/lib/api";
import { IconButton, PopoverMenu } from "@/components/ui";
import { NotifyTargetsRow, toggleUserId } from "./NotifyTargetsRow";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { ToggleCard } from "./TransactionFieldRows";

/** 提前量单位，value 与后端一致。 */
export const REMIND_UNIT_OPTIONS = [
  { value: "day", label: "天" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
] as const;

export type RemindUnit = (typeof REMIND_UNIT_OPTIONS)[number]["value"];

/** 表单里的一档提醒。提前量用字符串是因为输入过程中会出现空串。 */
export type ReminderDraft = {
  /** 仅用于 React key 与增删定位，不提交给后端。 */
  key: string;
  leadValue: string;
  leadUnit: RemindUnit;
  remindTime: string;
  /** 这一档推给谁（用户 id）。渠道由接收人自己的通知设置决定。 */
  notifyUserIds: string[];
};

/** 档位上限，与后端 DTO 的 ArrayMaxSize 一致。 */
export const MAX_REMINDERS = 5;

const DEFAULT_REMIND_TIME = "09:00";

let draftSeq = 0;

export function createReminderDraft(
  leadValue: number,
  leadUnit: RemindUnit = "day",
  remindTime = DEFAULT_REMIND_TIME,
): ReminderDraft {
  draftSeq += 1;
  return {
    key: `reminder-${draftSeq}`,
    leadValue: String(leadValue),
    leadUnit,
    remindTime,
    notifyUserIds: [],
  };
}

/** 接口返回的档位 → 表单草稿。 */
export function toReminderDrafts(reminders: ReminderSchedule[] | undefined): ReminderDraft[] {
  return (reminders ?? []).map((reminder) => {
    draftSeq += 1;
    return {
      key: `reminder-${reminder.id}-${draftSeq}`,
      leadValue: String(reminder.leadValue),
      leadUnit: reminder.leadUnit,
      remindTime: reminder.remindTime,
      notifyUserIds: reminder.notifyTargets.map((target) => target.userId),
    };
  });
}

/**
 * 表单草稿 → 提交给后端的档位。
 *
 * 丢弃提前量非正整数的档（输入到一半就保存），并对相同提前量去重——后端会以 400 拒绝重复档位，
 * 但那对用户是一句莫名其妙的报错，这里先按「后写的覆盖先写的」收敛掉。
 */
export function toReminderPayload(drafts: ReminderDraft[]): Array<{
  leadValue: number;
  leadUnit: RemindUnit;
  remindTime: string;
  notifyUserIds: string[];
}> {
  const byLead = new Map<string, ReturnType<typeof toReminderPayload>[number]>();
  for (const draft of drafts) {
    const leadValue = Number.parseInt(draft.leadValue, 10);
    if (!Number.isFinite(leadValue) || leadValue <= 0) continue;
    byLead.set(`${leadValue}${draft.leadUnit}`, {
      leadValue,
      leadUnit: draft.leadUnit,
      remindTime: draft.remindTime || DEFAULT_REMIND_TIME,
      notifyUserIds: draft.notifyUserIds,
    });
  }
  return Array.from(byLead.values());
}

/** 「提前 30 天 · 09:00 · 推送给 张三」——详情页展示一档提醒用。 */
export function reminderSummary(reminder: ReminderSchedule): string {
  const unit =
    REMIND_UNIT_OPTIONS.find((option) => option.value === reminder.leadUnit)?.label ?? "";
  const receivers = reminder.notifyTargets.map((target) => target.alias).join("、");
  return [
    `提前 ${reminder.leadValue} ${unit}`,
    reminder.remindTime,
    receivers && `推送给 ${receivers}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function leadKeyOf(draft: ReminderDraft): string {
  return `${Number.parseInt(draft.leadValue, 10)}${draft.leadUnit}`;
}

/**
 * 新增一档时挑一个没被占用的提前量。
 *
 * 直接用默认值会和已有档撞车（第一档通常就是默认值），而相同提前量的两档在提交时会被合并，
 * 表现为「加了一档、保存后没了」。这里从默认值往后找第一个空位。
 */
function nextFreeLead(drafts: ReminderDraft[], defaultLeadValue: number, unit: RemindUnit): number {
  const used = new Set(drafts.map(leadKeyOf));
  for (let lead = defaultLeadValue; lead < defaultLeadValue + 999; lead += 1) {
    if (!used.has(`${lead}${unit}`)) return lead;
  }
  return defaultLeadValue;
}

/**
 * 多档到期提醒的编辑块（订阅与保单共用）。
 *
 * 每档独立配置提前量 / 提醒时刻 / 接收人：先发的那档可能只想提醒自己，
 * 临到期的那档才抄送家人。关掉开关等于清空所有档位。
 */
export function ReminderSchedulesEditor({
  candidates,
  candidatesLoading,
  defaultLeadValue,
  defaultLeadUnit = "day",
  enabled,
  footer,
  hint,
  label = "到期提醒",
  onChange,
  onEnabledChange,
  value,
}: {
  /** 可选接收人：本账本成员 + 每人当前可达的渠道。 */
  candidates: ReadonlyArray<NotifyTarget>;
  candidatesLoading?: boolean;
  /** 新增一档时的默认提前量（订阅 3 天、保单 30 天）。 */
  defaultLeadValue: number;
  defaultLeadUnit?: RemindUnit;
  enabled: boolean;
  /** 「需先设置到期日」这类提示，挂在列表下方。 */
  footer?: ReactNode;
  hint?: string;
  label?: string;
  onChange: (next: ReminderDraft[]) => void;
  onEnabledChange: (next: boolean) => void;
  value: ReminderDraft[];
}) {
  const update = (key: string, patch: Partial<ReminderDraft>) => {
    onChange(value.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };

  // 提前量重复的档位在保存时会被合并，先在界面上标出来，别让用户点了保存才发现少了一条。
  const duplicatedKeys = new Set(
    value.map(leadKeyOf).filter((leadKey, index, keys) => keys.indexOf(leadKey) !== index),
  );

  const toggleTarget = (key: string, userId: string) => {
    const draft = value.find((item) => item.key === key);
    if (!draft) return;
    update(key, { notifyUserIds: toggleUserId(draft.notifyUserIds, userId) });
  };

  return (
    <ToggleCard
      checked={enabled}
      hint={hint}
      label={label}
      onCheckedChange={(next) => {
        onEnabledChange(next);
        // 打开时至少给一档，否则开着开关却什么都没配，保存后等于没开。
        if (next && value.length === 0)
          onChange([createReminderDraft(defaultLeadValue, defaultLeadUnit)]);
      }}
    >
      {value.map((draft, index) => (
        <div className="reminder-tier" key={draft.key}>
          <div className="reminder-tier__head">
            <strong>第 {index + 1} 次提醒</strong>
            {value.length > 1 ? (
              <IconButton
                icon={<Trash2 size={16} />}
                label={`删除第 ${index + 1} 次提醒`}
                onClick={() => onChange(value.filter((item) => item.key !== draft.key))}
                variant="muted"
              />
            ) : null}
          </div>

          <LeadRow
            onChange={(next) => update(draft.key, { leadValue: next })}
            value={draft.leadValue}
          />
          <SelectRow
            label="提前量单位"
            onChange={(next) => update(draft.key, { leadUnit: next as RemindUnit })}
            options={REMIND_UNIT_OPTIONS}
            value={draft.leadUnit}
          />
          <div className="transaction-form__date-card">
            <TimeWheelPicker
              label="提醒时间"
              onValueChange={(next) => update(draft.key, { remindTime: next })}
              value={draft.remindTime}
            />
          </div>
          <NotifyTargetsRow
            candidates={candidates}
            loading={candidatesLoading}
            onToggle={(userId) => toggleTarget(draft.key, userId)}
            values={draft.notifyUserIds}
          />
          {duplicatedKeys.has(leadKeyOf(draft)) ? (
            <p className="px-1 text-xs text-[var(--color-accent-warning)]">
              与其它提醒的提前量相同，保存时只会保留一条。
            </p>
          ) : null}
        </div>
      ))}

      {value.length < MAX_REMINDERS ? (
        <button
          className="reminder-tier__add"
          onClick={() =>
            onChange([
              ...value,
              createReminderDraft(
                nextFreeLead(value, defaultLeadValue, defaultLeadUnit),
                defaultLeadUnit,
              ),
            ])
          }
          type="button"
        >
          <Plus size={16} />
          <span>添加提醒</span>
        </button>
      ) : (
        <p className="px-1 text-xs text-[var(--color-text-muted)]">最多 {MAX_REMINDERS} 档提醒。</p>
      )}

      {footer}
    </ToggleCard>
  );
}

function LeadRow({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const handle = (event: ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 3));
  return (
    <label className="account-form__field-row">
      <span>提前</span>
      <span className="account-form__input-wrap">
        <input
          className="account-form__input"
          inputMode="numeric"
          maxLength={3}
          onChange={handle}
          placeholder="3"
          value={value}
        />
      </span>
    </label>
  );
}

function SelectRow({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="relative">
      <button
        className="transaction-form__select-row"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{label}</span>
        <strong>{selected ? selected.label : "请选择"}</strong>
        <ChevronRight size={18} />
      </button>
      <PopoverMenu
        groups={[
          options.map((option) => ({
            label: option.label,
            onSelect: () => onChange(option.value),
            selected: option.value === value,
          })),
        ]}
        onOpenChange={setOpen}
        open={open}
      />
    </div>
  );
}
