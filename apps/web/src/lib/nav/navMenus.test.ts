import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAV_MENU_HIDDEN,
  DEFAULT_NAV_MENU_ORDER,
  type NavMenuKey,
  resolveNavMenuLayout,
} from "./navMenus";

const keysOf = (menus: { key: NavMenuKey }[]) => menus.map((menu) => menu.key);

describe("resolveNavMenuLayout", () => {
  it("默认配置：可见项进 primary，隐藏项按顺序进 overflow", () => {
    const { primary, overflow } = resolveNavMenuLayout(
      DEFAULT_NAV_MENU_ORDER,
      DEFAULT_NAV_MENU_HIDDEN,
      3,
    );
    expect(keysOf(primary)).toEqual(["bills", "accounts", "budget"]);
    // 隐藏的 4 个按配置顺序收进「更多」，不丢失。
    expect(keysOf(overflow)).toEqual(["ledgers", "insurances", "items", "subscriptions"]);
  });

  it("超过容量：可见但超额的菜单溢出到 overflow，且保持配置顺序", () => {
    // 全部可见（无隐藏），容量 3。
    const { primary, overflow } = resolveNavMenuLayout(DEFAULT_NAV_MENU_ORDER, [], 3);
    expect(keysOf(primary)).toEqual(["bills", "accounts", "budget"]);
    expect(keysOf(overflow)).toEqual(["ledgers", "insurances", "items", "subscriptions"]);
  });

  it("隐藏 + 溢出混合：overflow 始终按 order 排序合并两类", () => {
    // 顺序把 items 提到最前并隐藏 accounts，容量 3。
    const order: NavMenuKey[] = [
      "items",
      "bills",
      "accounts",
      "budget",
      "ledgers",
      "insurances",
      "subscriptions",
    ];
    const { primary, overflow } = resolveNavMenuLayout(order, ["accounts"], 3);
    // 可见按 order：items, bills, (accounts 隐藏跳过), budget → 取前 3。
    expect(keysOf(primary)).toEqual(["items", "bills", "budget"]);
    // overflow = 未进 primary 的全部，按 order：accounts(隐藏), ledgers, insurances, subscriptions。
    expect(keysOf(overflow)).toEqual(["accounts", "ledgers", "insurances", "subscriptions"]);
  });

  it("不传容量：桌面场景不限制 primary，overflow 仅含隐藏项", () => {
    const { primary, overflow } = resolveNavMenuLayout(DEFAULT_NAV_MENU_ORDER, ["ledgers"]);
    expect(keysOf(primary)).toEqual([
      "bills",
      "accounts",
      "budget",
      "insurances",
      "items",
      "subscriptions",
    ]);
    expect(keysOf(overflow)).toEqual(["ledgers"]);
  });
});
