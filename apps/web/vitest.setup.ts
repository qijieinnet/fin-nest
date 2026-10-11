import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: {
    supports: () => true,
  },
});

// 现有用例都按中文文案断言；jsdom 的 navigator.language 是 en-US，这里固定成中文。
import { setPreferredLocale } from "@/lib/i18n";
setPreferredLocale("zh-CN");
