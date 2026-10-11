import { afterEach, describe, expect, it } from "vitest";
import { en } from "./messages/en";
import { localized, msg } from "./localized";
import { setPreferredLocale } from "./store";
import { setRenderLocale, t, translateDynamic } from "./translate";

afterEach(() => {
  setPreferredLocale("zh-CN");
  setRenderLocale("zh-CN");
});

describe("i18n", () => {
  it("中文界面直接显示键，英文查词典并插值", () => {
    setRenderLocale("zh-CN");
    expect(t("共 {count} 笔", { count: 3 })).toBe("共 3 笔");
    setRenderLocale("en");
    expect(t("共 {count} 笔", { count: 3 })).toBe("3 in total");
  });

  it("上下文键在中文下只显示 @@ 之前的部分", () => {
    setRenderLocale("zh-CN");
    expect(t("注册@@biometric")).toBe("注册");
    setRenderLocale("en");
    expect(t("注册@@biometric")).toBe("Register");
    expect(t("注册")).toBe("Sign up");
  });

  it("localized 常量在读取时才按当前语言翻译", () => {
    const labels = localized({
      expense: msg("支出"),
      code: "expense",
      nested: [{ label: msg("收入") }],
    });
    setRenderLocale("zh-CN");
    expect(labels.expense).toBe("支出");
    setRenderLocale("en");
    expect(labels.expense).toBe("Expense");
    expect(labels.nested[0]!.label).toBe("Income");
    expect(labels.code).toBe("expense");
  });

  it("translateDynamic 遇到词典外的字符串原样返回", () => {
    setRenderLocale("en");
    expect(translateDynamic("用户自建分类")).toBe("用户自建分类");
  });

  it("英文词典的插值占位与中文键一致", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders(value), key).toBe(placeholders(key));
    }
  });
});
