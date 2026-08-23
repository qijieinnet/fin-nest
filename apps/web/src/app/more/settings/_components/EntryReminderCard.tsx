"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { NotifyTargetsRow, TimeWheelPicker, toggleUserId } from "@/components/business";
import { PopoverMenu, Switch } from "@/components/ui";
import type { EntryReminder, EntryReminderFrequency, EntryReminderInput } from "@/lib/api";
import { useNotifyCandidates } from "@/lib/data/notifications";

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: EntryReminderFrequency; label: string }> = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];

/** ISO 星期：1=周一 … 7=周日，与后端存储口径一致。 */
const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 7, label: "日" },
] as const;

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** 切到「每周/每月」时若一个都没选，默认勾上今天——空选中后端会拒绝，也没人想收不到提醒。 */
function todayWeekday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function toggleValue(values: number[], value: number): number[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].sort((a, b) => a - b);
}

/**
 * 记账提醒设置块。
 *
 * 本地持有一份草稿即时反馈，改动同时发 PATCH（与本页其它开关一致的即改即存），
 * 服务端返回后由 `value` 重新同步。
 */
export function EntryReminderCard({
  ledgerId,
  onChange,
  value,
}: {
  ledgerId: string;
  onChange: (patch: EntryReminderInput) => void;
  value: EntryReminder;
}) {
  const [draft, setDraft] = useState<EntryReminder>(value);
  const [frequencyOpen, setFrequencyOpen] = useState(false);

  // 服务端值变化（保存成功、切换账本）时同步回来；用户正在编辑的字段也以服务端为准，
  // 因为每次改动都会立刻提交，两者不会长时间不一致。
  useEffect(() => setDraft(value), [value]);

  // 可选接收人 = 本账本成员。走哪条渠道由接收人自己的通知设置决定，这里不区分。
  const candidatesQuery = useNotifyCandidates(ledgerId);
  const candidates = candidatesQuery.data ?? [];
  const selectedUserIds = draft.notifyTargets.map((target) => target.userId);

  /** 本地先改、同时提交。patch 只带真正变化的字段，避免把并发的其它改动覆盖回去。 */
  const apply = (patch: EntryReminderInput, next: Partial<EntryReminder>) => {
    setDraft((current) => ({ ...current, ...next }));
    onChange(patch);
  };

  const setFrequency = (frequency: EntryReminderFrequency) => {
    const weekdays =
      frequency === "weekly" && draft.weekdays.length === 0 ? [todayWeekday()] : draft.weekdays;
    const monthDays =
      frequency === "monthly" && draft.monthDays.length === 0
        ? [new Date().getDate()]
        : draft.monthDays;
    apply({ frequency, weekdays, monthDays }, { frequency, weekdays, monthDays });
  };

  const toggleTarget = (userId: string) => {
    const nextIds = toggleUserId(selectedUserIds, userId);
    // 本地草稿直接从候选列表取整条（含 channels），这样「收不到」的提示无需等服务端返回。
    apply(
      { notifyUserIds: nextIds },
      { notifyTargets: candidates.filter((candidate) => nextIds.includes(candidate.userId)) },
    );
  };

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3 px-4 py-[15px]">
        <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">提醒记账</span>
        <Switch
          checked={draft.enabled}
          label="提醒记账"
          onCheckedChange={(checked) => apply({ enabled: checked }, { enabled: checked })}
        />
      </div>

      {draft.enabled ? (
        <div className="entry-reminder__body">
          <div className="relative">
            <button
              className="transaction-form__select-row"
              onClick={() => setFrequencyOpen((open) => !open)}
              type="button"
            >
              <span>提醒周期</span>
              <strong>
                {FREQUENCY_OPTIONS.find((option) => option.value === draft.frequency)?.label ??
                  "每天"}
              </strong>
              <ChevronRight size={18} />
            </button>
            <PopoverMenu
              groups={[
                FREQUENCY_OPTIONS.map((option) => ({
                  label: option.label,
                  onSelect: () => setFrequency(option.value),
                  selected: option.value === draft.frequency,
                })),
              ]}
              onOpenChange={setFrequencyOpen}
              open={frequencyOpen}
            />
          </div>

          {draft.frequency === "weekly" ? (
            <div className="transaction-form__chip-row">
              {WEEKDAYS.map((weekday) => {
                const selected = draft.weekdays.includes(weekday.value);
                return (
                  <button
                    className={`transaction-form__chip${selected ? " transaction-form__chip--selected" : ""}`}
                    key={weekday.value}
                    onClick={() => {
                      const weekdays = toggleValue(draft.weekdays, weekday.value);
                      if (weekdays.length === 0) return; // 至少留一天，否则永远不会触发
                      apply({ weekdays }, { weekdays });
                    }}
                    type="button"
                  >
                    周{weekday.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {draft.frequency === "monthly" ? (
            <>
              <div className="entry-reminder__day-grid">
                {MONTH_DAYS.map((day) => {
                  const selected = draft.monthDays.includes(day);
                  return (
                    <button
                      className={`transaction-form__chip entry-reminder__day${selected ? " transaction-form__chip--selected" : ""}`}
                      key={day}
                      onClick={() => {
                        const monthDays = toggleValue(draft.monthDays, day);
                        if (monthDays.length === 0) return; // 至少留一个日期
                        apply({ monthDays }, { monthDays });
                      }}
                      type="button"
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                当月没有选中的日期（如 31 号）时，在当月最后一天提醒。
              </p>
            </>
          ) : null}

          <div className="transaction-form__date-card">
            <TimeWheelPicker
              label="提醒时间"
              onValueChange={(remindTime) => apply({ remindTime }, { remindTime })}
              value={draft.remindTime}
            />
          </div>

          <NotifyTargetsRow
            candidates={candidates}
            loading={candidatesQuery.isLoading}
            onToggle={toggleTarget}
            values={selectedUserIds}
          />
        </div>
      ) : null}
    </section>
  );
}

