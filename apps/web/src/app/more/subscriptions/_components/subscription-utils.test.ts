import { describe, expect, it, vi, afterEach } from "vitest";
import {
  reminderDateKey,
  isReminderDue,
  renewalReminderDue,
  remindLeadLabel,
} from "./subscription-utils";

const base = (o: Record<string, unknown>): any => ({
  terminatedAt: null,
  billingCycle: "monthly",
  nextRenewalDate: null,
  remindLeadValue: null,
  remindLeadUnit: null,
  ...o,
});

afterEach(() => vi.useRealTimers());

describe("reminderDateKey", () => {
  it("explicit day/week/year leads", () => {
    expect(
      reminderDateKey(base({ nextRenewalDate: "2026-03-01", remindLeadValue: 3, remindLeadUnit: "day" })),
    ).toBe("2026-02-26");
    expect(
      reminderDateKey(base({ nextRenewalDate: "2026-03-01", remindLeadValue: 2, remindLeadUnit: "week" })),
    ).toBe("2026-02-15");
    expect(
      reminderDateKey(base({ nextRenewalDate: "2026-01-01", remindLeadValue: 1, remindLeadUnit: "year" })),
    ).toBe("2025-01-01");
  });
  it("default fallback window by cycle (monthly=7d)", () => {
    expect(reminderDateKey(base({ nextRenewalDate: "2026-03-10" }))).toBe("2026-03-03");
  });
  it("null without renewal date", () => {
    expect(reminderDateKey(base({}))).toBeNull();
  });
});

describe("due predicates (frozen today = 2026-07-14)", () => {
  const freeze = () => vi.setSystemTime(new Date("2026-07-14T04:00:00.000Z"));
  it("due once reminder date reached", () => {
    freeze();
    expect(
      isReminderDue(base({ nextRenewalDate: "2026-07-15", remindLeadValue: 3, remindLeadUnit: "day" })),
    ).toBe(true);
  });
  it("not due when far in future", () => {
    freeze();
    expect(
      isReminderDue(base({ nextRenewalDate: "2026-12-01", remindLeadValue: 1, remindLeadUnit: "day" })),
    ).toBe(false);
  });
  it("terminated never due", () => {
    freeze();
    expect(
      isReminderDue(
        base({ terminatedAt: "2026-01-01", nextRenewalDate: "2026-07-15", remindLeadValue: 3, remindLeadUnit: "day" }),
      ),
    ).toBe(false);
  });
  it("custom cycle not confirmable, monthly is", () => {
    freeze();
    const due = { nextRenewalDate: "2026-07-15", remindLeadValue: 3, remindLeadUnit: "day" };
    expect(renewalReminderDue(base({ billingCycle: "custom", ...due }))).toBe(false);
    expect(renewalReminderDue(base({ billingCycle: "monthly", ...due }))).toBe(true);
  });
});

describe("remindLeadLabel", () => {
  it("formats and blanks", () => {
    expect(remindLeadLabel(base({ remindLeadValue: 2, remindLeadUnit: "week" }))).toBe("提前 2 周");
    expect(remindLeadLabel(base({}))).toBe("");
  });
});
