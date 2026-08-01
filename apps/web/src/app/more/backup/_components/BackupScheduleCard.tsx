"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { TimeWheelPicker } from "@/components/business";
import { PopoverMenu, Switch } from "@/components/ui";
import type { BackupFrequency, BackupSetting, BackupSettingInput } from "@/lib/api";

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: BackupFrequency; label: string }> = [
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

const KEEP_OPTIONS = [3, 7, 14, 30, 0];

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
 * 周期备份设置块。
 *
 * 交互与「记账提醒」一致（即改即存 + 本地草稿即时反馈），周期口径也刻意一样：
 * 每天 / 每周某几天 / 每月某几号，选中的日号当月不存在时落到当月最后一天。
 */
export function BackupScheduleCard({
  onChange,
  value,
}: {
  onChange: (patch: BackupSettingInput) => void;
  value: BackupSetting;
}) {
  const [draft, setDraft] = useState<BackupSetting>(value);
  const [frequencyOpen, setFrequencyOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const apply = (patch: BackupSettingInput) => {
    setDraft((current) => ({ ...current, ...patch }));
    onChange(patch);
  };

  const setFrequency = (frequency: BackupFrequency) => {
    // 切到每周/每月时一个都没选，后端会拒绝——默认勾上今天，省一次报错往返。
    const weekdays =
      frequency === "weekly" && draft.weekdays.length === 0 ? [todayWeekday()] : draft.weekdays;
    const monthDays =
      frequency === "monthly" && draft.monthDays.length === 0
        ? [new Date().getDate()]
        : draft.monthDays;
    apply({ frequency, weekdays, monthDays });
  };

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3 px-4 py-[15px]">
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] text-[var(--color-text-primary)]">周期自动备份</span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
            到点由后台任务生成备份，无需保持页面打开
          </span>
        </span>
        <Switch
          checked={draft.enabled}
          label="周期自动备份"
          onCheckedChange={(enabled) => apply({ enabled })}
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
              <span>备份周期</span>
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
                      apply({ weekdays });
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
                        apply({ monthDays });
                      }}
                      type="button"
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                当月没有选中的日期（如 31 号）时，在当月最后一天备份。
              </p>
            </>
          ) : null}

          <div className="transaction-form__date-card">
            <TimeWheelPicker
              label="备份时间"
              onValueChange={(runTime) => apply({ runTime })}
              value={draft.runTime}
            />
          </div>

          <div className="relative">
            <button
              className="transaction-form__select-row"
              onClick={() => setKeepOpen((open) => !open)}
              type="button"
            >
              <span>保留份数</span>
              <strong>{draft.keepCount === 0 ? "不限" : `最近 ${draft.keepCount} 份`}</strong>
              <ChevronRight size={18} />
            </button>
            <PopoverMenu
              groups={[
                KEEP_OPTIONS.map((count) => ({
                  label: count === 0 ? "不限" : `最近 ${count} 份`,
                  onSelect: () => apply({ keepCount: count }),
                  selected: count === draft.keepCount,
                })),
              ]}
              onOpenChange={setKeepOpen}
              open={keepOpen}
            />
          </div>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            超出份数时按时间从旧到新清理，只清理自动备份，手动备份始终保留。
          </p>
        </div>
      ) : null}
    </section>
  );
}
