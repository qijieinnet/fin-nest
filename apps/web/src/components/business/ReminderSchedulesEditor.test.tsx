import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReminderSchedule } from "@/lib/api";
import {
  ReminderSchedulesEditor,
  toReminderDrafts,
  toReminderPayload,
} from "./ReminderSchedulesEditor";

function schedule(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    id: `sched-${Math.random().toString(36).slice(2)}`,
    leadValue: 30,
    leadUnit: "day",
    remindTime: "09:00",
    notifyTargets: [],
    ...overrides,
  };
}

describe("多档提醒的回显与提交", () => {
  it("接口返回几档就回填几档，且各档的时间与接收人独立", () => {
    const drafts = toReminderDrafts([
      schedule({ leadValue: 30, leadUnit: "day", remindTime: "09:00" }),
      schedule({
        leadValue: 7,
        leadUnit: "day",
        remindTime: "20:00",
        notifyTargets: [{ userId: "u1", alias: "老婆", channels: ["feishu", "webpush"] }],
      }),
    ]);
    expect(drafts).toHaveLength(2);
    expect(
      drafts.map((draft) => `${draft.leadValue}${draft.leadUnit}@${draft.remindTime}`),
    ).toEqual(["30day@09:00", "7day@20:00"]);
    expect(drafts[1]!.notifyUserIds).toEqual(["u1"]);
    // key 必须两两不同，否则 React 会把后一档当成前一档复用。
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(2);
  });

  it("多档会全部渲染出来", () => {
    const drafts = toReminderDrafts([
      schedule({ leadValue: 30, leadUnit: "day" }),
      schedule({ leadValue: 7, leadUnit: "day", remindTime: "20:00" }),
    ]);
    render(
      <ReminderSchedulesEditor
        candidates={[]}
        defaultLeadValue={30}
        enabled
        onChange={vi.fn()}
        onEnabledChange={vi.fn()}
        value={drafts}
      />,
    );
    expect(screen.getByText("第 1 次提醒")).toBeInTheDocument();
    expect(screen.getByText("第 2 次提醒")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();
  });

  it("提交时保留全部档位；提前量相同的档会被合并（后写的赢）", () => {
    const drafts = toReminderDrafts([
      schedule({ leadValue: 30, leadUnit: "day", remindTime: "09:00" }),
      schedule({ leadValue: 7, leadUnit: "day", remindTime: "20:00" }),
    ]);
    expect(toReminderPayload(drafts)).toHaveLength(2);

    // 「添加提醒」给的默认提前量与已有档相同时，两档会塌成一档——这是刻意的去重，
    // 但对用户表现为「加了一档却没保存上」，所以用例锁住这个行为，改动时必须是有意的。
    const duplicated = toReminderDrafts([
      schedule({ leadValue: 30, leadUnit: "day", remindTime: "09:00" }),
      schedule({ leadValue: 30, leadUnit: "day", remindTime: "21:00" }),
    ]);
    expect(toReminderPayload(duplicated)).toEqual([
      { leadValue: 30, leadUnit: "day", remindTime: "21:00", notifyUserIds: [] },
    ]);
  });
});
