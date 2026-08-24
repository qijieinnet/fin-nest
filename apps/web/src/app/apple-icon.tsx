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
        // 与 icon.svg 保持纯白底；圆角由 iOS 按系统版本裁切。
        background: "#FFFFFF",
      }}
    >
      <svg width="180" height="180" viewBox="0 0 128 128">
        <defs>
          <linearGradient
            id="finNestAppleGradient"
            x1="35"
            x2="94"
            y1="36"
            y2="98"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#7259D9" />
            <stop offset="0.52" stopColor="#4B68D5" />
            <stop offset="1" stopColor="#2698C1" />
          </linearGradient>
        </defs>
        <path
          d="M37 87 V40 L91 87 V40"
          fill="none"
          stroke="url(#finNestAppleGradient)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M37 87 Q64 103 91 87"
          fill="none"
          stroke="url(#finNestAppleGradient)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="64" cy="63" r="12" fill="url(#finNestAppleGradient)" />
        <path
          d="M64 54 C65.1 59.1 67.9 61.9 73 63 C67.9 64.1 65.1 66.9 64 72 C62.9 66.9 60.1 64.1 55 63 C60.1 61.9 62.9 59.1 64 54Z"
          fill="#FFFFFF"
        />
      </svg>
    </div>,
    size,
  );
}
