import { ImageResponse } from "next/og";

/**
 * iOS 主屏图标（apple-touch-icon）。
 *
 * 必须单独出一张 **PNG**：iOS 不认 SVG 的 apple-touch-icon，缺这张时「添加到主屏幕」
 * 会拿网页截图当图标——而主屏图标正是 iOS 上开启 Web Push 的前置步骤，一个截图图标
 * 会让人以为装错了。用 ImageResponse 在构建期渲染，省得往仓库里塞二进制。
 *
 * 180×180 是 iOS 的推荐尺寸；不留圆角与留白，系统会自己按当前 iOS 版本裁切。
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // 与 icon.svg 同一组配色（浅蓝渐变 + 暖黄圆点 + 三道弧线）。
        background: "linear-gradient(180deg, #EFF4FD 0%, #DBE8F8 100%)",
      }}
    >
      <svg width="180" height="180" viewBox="0 0 128 128">
        <circle cx="64" cy="48" r="12" fill="#F1C877" />
        <path
          d="M26 58 Q64 90 102 58"
          fill="none"
          stroke="#7295D4"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M34 64 Q64 87 94 64"
          fill="none"
          stroke="#7295D4"
          strokeWidth="3.4"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M43 69 Q64 82 85 69"
          fill="none"
          stroke="#7295D4"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.45"
        />
      </svg>
    </div>,
    size,
  );
}
