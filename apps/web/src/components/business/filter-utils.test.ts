import { describe, expect, it } from "vitest";
import { countActiveFilters } from "./filter-utils";

describe("countActiveFilters", () => {
  it("treats the default filter value as having no active filters", () => {
    expect(countActiveFilters({ timePreset: "month", type: "all" })).toBe(0);
  });

  it("counts a selection once even when singular and plural keys are both set", () => {
    expect(
      countActiveFilters({
        timePreset: "month",
        type: "all",
        accountId: "a1",
        accountIds: ["a1"],
      }),
    ).toBe(1);
  });

  it("counts category, account, and time as three distinct active filters", () => {
    expect(
      countActiveFilters({
        timePreset: "custom",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        type: "all",
        categoryId: "c1",
        categoryIds: ["c1"],
        subcategoryIds: ["c1-1"],
        accountIds: ["a1", "a2"],
      }),
    ).toBe(3);
  });
});
