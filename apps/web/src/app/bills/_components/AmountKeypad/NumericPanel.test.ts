import { describe, expect, it } from "vitest";
import { KEY_ROWS } from "./NumericPanel";

describe("数字键位布局", () => {
  // 键区是 4 列网格、按 DOM 顺序逐行填充。曾经因为「先渲染所有数字、再渲染功能键」
  // 导致数字整体错位（7 8 9 4 / 5 6 1 2 / ...），typecheck 与 lint 都发现不了。
  it("扁平顺序与 4 列网格的视觉行一致", () => {
    expect(KEY_ROWS.flat().map((spec) => spec.id)).toEqual([
      "7", "8", "9", "backspace",
      "4", "5", "6", "minus",
      "1", "2", "3", "plus",
      "dot", "0", "double-zero", "equals",
    ]);
  });

  it("每行正好 4 个键，否则整块网格会错位", () => {
    for (const row of KEY_ROWS) expect(row).toHaveLength(4);
  });
});
