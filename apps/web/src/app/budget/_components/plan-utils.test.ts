import { describe, expect, it } from "vitest";
import { parseLimitCount } from "./plan-utils";

describe("parseLimitCount", () => {
  it("accepts plain positive integers", () => {
    expect(parseLimitCount("3")).toBe(3);
    expect(parseLimitCount(" 12 ")).toBe(12);
  });

  it("rejects instead of silently truncating what parseInt would accept", () => {
    // parseInt 会把这些分别读成 3 / 12 / 12，用户看不出输入被改过。
    expect(parseLimitCount("3.7")).toBeNull();
    expect(parseLimitCount("12次")).toBeNull();
    expect(parseLimitCount("12e3")).toBeNull();
  });

  it("rejects empty, zero and negative input", () => {
    expect(parseLimitCount("")).toBeNull();
    expect(parseLimitCount("0")).toBeNull();
    expect(parseLimitCount("-1")).toBeNull();
  });
});
