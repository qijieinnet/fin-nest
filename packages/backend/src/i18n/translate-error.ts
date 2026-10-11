import { EN_ERROR_MESSAGES, EN_ERROR_TEMPLATES } from "./error-messages.en";

export type ErrorLocale = "zh-CN" | "en";

/**
 * 从请求头取界面语言：前端每次请求都带 `Accept-Language`（用户设置 > 设备语言）。
 * 只认第一项；中文或无法识别时回到中文（文案原文就是中文，零成本）。
 */
export function errorLocaleFromHeader(header: string | string[] | undefined): ErrorLocale {
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "zh-CN";
}

type CompiledTemplate = { pattern: RegExp; target: string };

let compiled: CompiledTemplate[] | null = null;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTemplates(): CompiledTemplate[] {
  compiled ??= Object.entries(EN_ERROR_TEMPLATES).map(([source, target]) => {
    const parts = source.split(/\{\d+\}/);
    return { pattern: new RegExp(`^${parts.map(escapeRegExp).join("([\\s\\S]*?)")}$`), target };
  });
  return compiled;
}

/** 把中文错误文案翻成目标语言；没有对照时原样返回（退化为中文，不报错）。 */
export function translateErrorMessage(message: string, locale: ErrorLocale): string {
  if (locale === "zh-CN" || !message) return message;
  const exact = EN_ERROR_MESSAGES[message];
  if (exact) return exact;
  for (const { pattern, target } of compileTemplates()) {
    const match = pattern.exec(message);
    if (match) {
      return target.replace(/\{(\d+)\}/g, (_, index: string) => {
        const value = match[Number(index) + 1] ?? "";
        // 插值本身也可能是一段已知文案（如字段名），能翻就顺手翻掉。
        return EN_ERROR_MESSAGES[value] ?? value;
      });
    }
  }
  return message;
}
