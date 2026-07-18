/**
 * 轻量触感反馈。仅在支持 Vibration API 的设备/浏览器（主要是 Android Chrome 等）生效；
 * iOS Safari 不支持 navigator.vibrate，会静默跳过。
 *
 * 只保留给「有意义的瞬间」——吸附、开关、提交、删除（apple-design §13 Utility）：
 * 过度反馈会训练用户忽略所有反馈。
 */
export type HapticPattern = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 8,
  medium: 14,
  success: [10, 40, 12],
  warning: [16, 60, 16],
};

export function haptic(pattern: HapticPattern = "light"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // 某些浏览器在缺少用户手势时会抛错，忽略即可。
  }
}
