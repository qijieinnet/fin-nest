"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TimeWheelPicker } from "@/components/business";
import { PopoverMenu, Switch } from "@/components/ui";
import type { EntryReminder, EntryReminderFrequency, EntryReminderInput } from "@/lib/api";
import { useFeishuStatus, useLedgerFeishuBindings } from "@/lib/data/feishu";

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
  const [feishuOpen, setFeishuOpen] = useState(false);

  // 服务端值变化（保存成功、切换账本）时同步回来；用户正在编辑的字段也以服务端为准，
  // 因为每次改动都会立刻提交，两者不会长时间不一致。
  useEffect(() => setDraft(value), [value]);

  // 未配置飞书时不发这个请求，整行也不渲染——这是「没开这个功能」，不是「没绑账号」。
  const feishuStatusQuery = useFeishuStatus();
  const feishuEnabled = feishuStatusQuery.data?.enabled ?? false;
  const feishuBindingsQuery = useLedgerFeishuBindings(ledgerId, feishuEnabled);

  // 同一个人可能绑多个飞书号，所以标签是「昵称（成员别名）」；昵称取不到时回退 open_id 尾段。
  const feishuOptions = useMemo(
    () =>
      (feishuBindingsQuery.data ?? []).map((binding) => ({
        value: binding.id,
        label: `${binding.displayName ?? `飞书账号 ···${binding.openIdSuffix}`}（${binding.userAlias}）`,
      })),
    [feishuBindingsQuery.data],
  );
  const selectedBindingIds = draft.feishuBindings.map((binding) => binding.id);

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

  const toggleBinding = (bindingId: string) => {
    const nextIds = toggleId(selectedBindingIds, bindingId);
    apply(
      { feishuBindingIds: nextIds },
      {
        feishuBindings: feishuOptions
          .filter((option) => nextIds.includes(option.value))
          .map((option) => ({
            id: option.value,
            displayName: option.label,
            openIdSuffix: "",
          })),
      },
    );
  };

  const feishuDisplay =
    feishuOptions.length === 0
      ? "无可用飞书账号"
      : selectedBindingIds.length === 0
        ? "不推送"
        : feishuOptions
            .filter((option) => selectedBindingIds.includes(option.value))
            .map((option) => option.label)
            .join("、");

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

          {feishuEnabled ? (
            <>
              <div className="relative">
                <button
                  className="transaction-form__select-row"
                  disabled={feishuOptions.length === 0}
                  onClick={() => setFeishuOpen((open) => !open)}
                  type="button"
                >
                  <span>推送飞书</span>
                  <strong>{feishuDisplay}</strong>
                  <ChevronRight size={18} />
                </button>
                <PopoverMenu
                  groups={[
                    feishuOptions.map((option) => ({
                      label: option.label,
                      onSelect: () => toggleBinding(option.value),
                      selected: selectedBindingIds.includes(option.value),
                    })),
                  ]}
                  onOpenChange={setFeishuOpen}
                  open={feishuOpen}
                />
              </div>
              {feishuOptions.length === 0 && !feishuBindingsQuery.isLoading ? (
                <p className="px-1 text-xs text-[var(--color-text-muted)]">
                  账本成员均未绑定飞书，可在「更多 › 飞书」中绑定。
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function toggleId(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
