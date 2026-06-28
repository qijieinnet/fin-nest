import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { FilterSheet } from "./FilterSheet";

describe("FilterSheet", () => {
  it("renders only the configured fields", () => {
    render(
      createElement(FilterSheet, {
        fields: ["type", "keyword"],
        onApply: vi.fn(),
        onChange: vi.fn(),
        onOpenChange: vi.fn(),
        open: true,
        value: { type: "all" },
      }),
    );

    expect(screen.getByRole("tab", { name: "分类" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "其它" }));
    expect(screen.getByPlaceholderText("输入备注关键词...")).toBeInTheDocument();
    expect(screen.queryByText("选择分类")).not.toBeInTheDocument();
    expect(screen.queryByText("选择账户")).not.toBeInTheDocument();
  });
});
