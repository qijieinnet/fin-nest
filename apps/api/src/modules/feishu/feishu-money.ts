import { MONEY_SCALE } from "@fin-nest/shared";

/**
 * 卡片展示用的金额格式化。
 *
 * `formatMicros` / `currencySymbol` 已下沉到 `@fin-nest/backend`——worker 渲染推送卡片时也要用，
 * 这里转发出去，保持既有 import 路径不变。`progressBar` 是卡片专属，留在本文件。
 */
export { currencySymbol, formatMicros } from "@fin-nest/backend";

/** 文本进度条：飞书卡片没有原生进度组件，用方块字符代替。 */
export function progressBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

export { MONEY_SCALE };
