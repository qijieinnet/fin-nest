import { describe, expect, it } from "vitest";
import { safeNext } from "./LoginScreen";

const ORIGIN = "https://fin.example.com";

/**
 * 登录后回跳地址的同源校验。
 *
 * 这条校验是防开放重定向的唯一一道闸：`?next=` 来自 URL，攻击者可以把
 * `https://站点/login?next=<钓鱼站>` 这样的链接丢给用户，登录成功后直接把人送走。
 * 用例锁住几种绕过前缀检查的写法，改动时必须是有意的。
 */
describe("safeNext", () => {
  it("放行站内路径，并保留 query 与 hash", () => {
    expect(safeNext("/n/abc", ORIGIN)).toBe("/n/abc");
    expect(safeNext("/bills?type=expense#top", ORIGIN)).toBe("/bills?type=expense#top");
  });

  it("挡住协议相对地址", () => {
    expect(safeNext("//evil.com", ORIGIN)).toBeNull();
  });

  it("挡住反斜杠变体——URL 解析器把 \\ 也当路径分隔符", () => {
    // 这两个都以 "/" 开头且不以 "//" 开头，纯前缀判断会放它们过去，
    // 但实际解析出来是 https://evil.com/。
    expect(safeNext("/\\evil.com", ORIGIN)).toBeNull();
    expect(safeNext("/\\\\evil.com", ORIGIN)).toBeNull();
  });

  it("挡住绝对地址与非路径输入", () => {
    expect(safeNext("https://evil.com", ORIGIN)).toBeNull();
    expect(safeNext("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(safeNext("bills", ORIGIN)).toBeNull();
    expect(safeNext("", ORIGIN)).toBeNull();
    expect(safeNext(null, ORIGIN)).toBeNull();
  });

  it("编码过的反斜杠是普通字符，仍算同源", () => {
    expect(safeNext("/%5Cevil.com", ORIGIN)).toBe("/%5Cevil.com");
  });
});
