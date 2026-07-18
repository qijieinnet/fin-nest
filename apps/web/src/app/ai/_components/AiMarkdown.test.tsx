import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiMarkdown } from "./AiMarkdown";

describe("AiMarkdown", () => {
  it("renders common and GitHub-flavored Markdown", () => {
    render(
      <AiMarkdown
        content={[
          "**本月结余**",
          "",
          "| 类型 | 金额 |",
          "| --- | ---: |",
          "| 收入 | 100 |",
          "",
          "- [x] 已核对",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("本月结余").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("does not execute raw HTML and opens links safely", () => {
    const { container } = render(
      <AiMarkdown content={'<script>alert("xss")</script>\n\n[查看详情](https://example.com)'} />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.queryByText('alert("xss")')).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看详情" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(screen.getByRole("link", { name: "查看详情" })).toHaveAttribute("target", "_blank");
  });
});
