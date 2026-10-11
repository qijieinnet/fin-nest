import { en, type MessageKey } from "./messages/en";
import { translateDynamic } from "./translate";

/**
 * 标记模块级常量里的界面文案（编译期校验它在词典里），本身原样返回中文键。
 * 必须配合 `localized()` 使用，否则界面上看到的仍是中文。
 */
export function msg<K extends MessageKey>(key: K): K {
  return key;
}

function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  // React 元素 / forwardRef 组件（lucide 图标）都带 $$typeof，不能拆开复制。
  if ("$$typeof" in value) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * 模块级常量（标签表、选项数组）在模块求值时语言还没确定，直接调 `t()` 会把语言定死。
 * 这里返回一份结构相同的副本：凡是词典里有的字符串值都换成 getter，**每次读取**时按当前语言翻译。
 * 使用处无需改动（`LABELS[type]`、`OPTIONS.map(o => o.label)` 照常工作）。
 */
export function localized<T>(source: T): T {
  if (!isPlainContainer(source)) return source;
  const target: Record<string | number, unknown> | unknown[] = Array.isArray(source) ? [] : {};
  for (const key of Object.keys(source)) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string" && isMessageKey(value)) {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: () => translateDynamic(value),
      });
    } else {
      (target as Record<string, unknown>)[key] = isPlainContainer(value) ? localized(value) : value;
    }
  }
  return target as T;
}
